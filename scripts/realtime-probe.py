#!/usr/bin/env python3
"""
Live realtime probe: does an INSERT made by service_role (exactly the
production order path) reach a signed-in staff subscriber over
postgres_changes?

Creates a throwaway user + project + staff_member, subscribes with that
user's JWT, inserts an order the way /api/public/order does, and reports
whether the event arrived. Cleans up everything it created.
"""
import asyncio
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

import websockets

ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env.local")
TAG = "rtprobe"


def env(name):
    txt = open(ENV).read()
    m = re.search(rf"^{name}=(.*)$", txt, re.M)
    if not m:
        sys.exit(f"missing {name} in .env.local")
    return m.group(1).strip().strip('"').strip("'")


URL = env("NEXT_PUBLIC_SUPABASE_URL")
ANON = env("NEXT_PUBLIC_SUPABASE_ANON_KEY")
SVC = env("SUPABASE_SERVICE_ROLE_KEY")
REF = URL.split("//", 1)[1].split(".", 1)[0]

SVC_H = {"apikey": SVC, "Authorization": f"Bearer {SVC}", "Content-Type": "application/json"}
ANON_H = {"apikey": ANON, "Content-Type": "application/json"}

created = {"user": None, "project": None}


def req(method, url, headers, body=None, expect=None):
    r = urllib.request.Request(url, method=method, headers=headers,
                               data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def rest(method, table, body=None, query=""):
    return req(method, f"{URL}/rest/v1/{table}{query}", SVC_H, body)


def cleanup():
    print("\n--- cleanup ---", flush=True)
    if created.get("order"):
        oid = created["order"]
        rest("DELETE", f"order_items?order_id=eq.{oid}")
        rest("DELETE", f"orders?id=eq.{oid}")
        rest("DELETE", f"order_audit_logs?order_id=eq.{oid}")
        print("order rows deleted", flush=True)
    if created.get("project"):
        pid = created["project"]
        for t in ("order_items", "orders", "order_audit_logs", "tables",
                  "products", "categories", "staff_members"):
            rest("DELETE", f"{t}?project_id=eq.{pid}")
        rest("DELETE", f"projects?id=eq.{pid}")
        print("project deleted", flush=True)
    if created.get("user"):
        uid = created["user"]
        req("DELETE", f"{URL}/auth/v1/admin/users/{uid}", SVC_H)
        print("user deleted", flush=True)


async def main():
    cleanup_state = {}
    try:
        # 1. throwaway auth user
        email = f"{TAG}-{int(time.time())}@example.com"
        st, body = req("POST", f"{URL}/auth/v1/admin/users", SVC_H,
                       {"email": email, "password": "Pr0be-Passw0rd!x",
                        "email_confirm": True})
        if st not in (200, 201):
            sys.exit(f"createUser {st}: {body}")
        uid = body.get("id") or (body.get("user") or {}).get("id")
        created["user"] = uid
        print(f"user {uid} {email}", flush=True)

        # 2. project + membership (mirrors onboarding)
        st, rows = rest("POST", "projects",
                        [{"name": "RT Probe", "slug": f"{TAG}-{int(time.time())}",
                          "created_by": uid}])
        if st != 201:
            sys.exit(f"project {st}: {rows}")
        pid = (rows if isinstance(rows, list) else [rows])[0]["id"]
        created["project"] = pid
        st, b = rest("POST", "staff_members", [{"project_id": pid, "user_id": uid, "role": "owner"}])
        if st != 201:
            sys.exit(f"staff {st}: {b}")
        print(f"project {pid} + staff member ok", flush=True)

        # 3. sign in as that user (anon key) -> the merchant's real condition
        st, tok = req("POST", f"{URL}/auth/v1/token?grant_type=password", ANON_H,
                      {"email": email, "password": "Pr0be-Passw0rd!x"})
        if st != 200:
            sys.exit(f"signin {st}: {tok}")
        access = tok["access_token"]
        print(f"staff access_token ok ({len(access)} chars)", flush=True)

        # 4. subscribe exactly like the dashboard does
        ws_url = f"wss://{REF}.supabase.co/realtime/v1/websocket?apikey={ANON}&vsn=1.0.0"
        async with websockets.connect(ws_url, additional_headers={
                "Authorization": f"Bearer {access}"}, max_size=None) as ws:
            topic = f"probe-{int(time.time())}"
            await ws.send(json.dumps({
                "topic": "realtime:public:orders", "event": "phx_join",
                "payload": {
                    "config": {
                        "broadcast": {"ack": False, "self": False},
                        "presence": {"key": ""},
                        "postgres_changes": [
                            {"event": "*", "schema": "public", "table": "orders"}],
                    },
                    "access_token": access,
                }, "ref": "1"}))
            joined = False
            deadline = time.time() + 20
            while time.time() < deadline and not joined:
                raw = await asyncio.wait_for(ws.recv(), timeout=20)
                msg = json.loads(raw)
                if msg.get("event") in ("phx_reply", "phx_close", "phx_error"):
                    print("join reply:", json.dumps(msg)[:400], flush=True)
                    if msg.get("event") == "phx_reply":
                        joined = True
            if not joined:
                print("RESULT: never joined", flush=True)
                return
            print("SUBSCRIBED", flush=True)

            # 5. insert an order exactly like the production path
            items = [{"product_id": None, "product_name": "probe item",
                      "quantity": 1, "unit_price": 1.5, "addons": [], "status": "pending"}]
            st, res = req("POST", f"{URL}/rest/v1/rpc/create_order_transactional", SVC_H,
                          {"p_project_id": pid, "p_type": "dinein", "p_status": "pending",
                           "p_total_amount": 1.5, "p_order_number": 0,
                           "p_items": items, "p_table_id": None,
                           "p_notes": "rt probe", "p_caller_user_id": uid,
                           "p_client_request_id": None})
            print(f"create_order_transactional -> {st} {json.dumps(res)[:200]}", flush=True)
            created["order"] = res.get("order", {}).get("id") if isinstance(res, dict) else None

            # 6. wait for the event
            t0 = time.time()
            got = None
            while time.time() - t0 < 15:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3)
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                if msg.get("event") == "postgres_changes":
                    got = time.time() - t0
                    print(f"EVENT in {got:.2f}s: {json.dumps(msg)[:300]}", flush=True)
                    break
            if got is None:
                print("RESULT: NO EVENT in 15s", flush=True)
                # sanity: did the row exist at all?
                st, rows = rest("GET", "orders", query=f"?project_id=eq.{pid}&select=id,status")
                print(f"row visible to service_role after wait: {st} {rows}", flush=True)
    finally:
        cleanup()


asyncio.run(main())
