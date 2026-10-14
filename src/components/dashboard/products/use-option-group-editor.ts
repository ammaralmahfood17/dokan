'use client';

import { useCallback, useRef, useState } from 'react';
import type { ProductWithOptions } from '@/lib/types';

/**
 * The product form's option-tree editor, as a hook.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4 phase b): the form
 * held the tree twice — once as state with five mutators, once as ~120 lines of
 * rows and inputs inside a 567-line modal. The mutators and the shape now live
 * here, the markup in `option-group-editor.tsx`, and the modal only wires them.
 *
 * The `key` fields are React keys for rows that have no id yet (a group the
 * merchant just added); `id` is set only for rows that came from the database.
 * Never use `key` as an identity for a write — the save path sends names and
 * prices only, and the RPC replaces the whole tree.
 */

/** Temporary option variety in the product form — `id` is set for persisted rows. */
export type FormChoice = { key: string; id?: string; name: string; price: string };

/**
 * Temporary option group.
 *
 * `required` and `single` are the merchant-facing switches the owner asked for
 * («أحدد لكل خيار: نوع واحد أو متعدد + إلزامي أو اختياري»); they map to
 * min_select / max_select on save. A multi group is written with a wide max —
 * the server clamps it to however many varieties are actually available, so a
 * sold-out variety can never make the group impossible to satisfy.
 */
export type FormGroup = {
  key: string;
  id?: string;
  name: string;
  required: boolean;
  single: boolean;
  choices: FormChoice[];
};

/** The product's saved tree, as form rows (sorted as the merchant arranged it). */
export function initialFormGroups(editing: ProductWithOptions | null): FormGroup[] {
  return (editing?.option_groups || [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g) => ({
      key: `init_${g.id}`,
      id: g.id,
      name: g.name,
      required: g.min_select >= 1,
      single: g.max_select <= 1,
      choices: (g.option_choices ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({
          key: `init_${c.id}`,
          id: c.id,
          name: c.name,
          price: String(c.price),
        })),
    }));
}

export function useOptionGroupEditor(editing: ProductWithOptions | null) {
  const [groups, setGroups] = useState<FormGroup[]>(() => initialFormGroups(editing));

  // Monotonic counter, not Math.random or an index: two rows added in the same
  // tick must not share a key, and a key must never be reused after a removal.
  const keyRef = useRef(0);
  const nextKey = useCallback((prefix: string) => {
    keyRef.current += 1;
    return `${prefix}_${keyRef.current}`;
  }, []);

  const addGroup = useCallback(() => {
    setGroups((prev) => [
      ...prev,
      {
        key: nextKey('group'),
        name: '',
        required: true,
        single: true,
        // Start with one empty variety so the merchant sees the shape immediately.
        choices: [{ key: nextKey('choice'), name: '', price: '0' }],
      },
    ]);
  }, [nextKey]);

  const updateGroup = useCallback(
    (key: string, patch: Partial<Pick<FormGroup, 'name' | 'required' | 'single'>>) => {
      setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
    },
    []
  );

  const removeGroup = useCallback((key: string) => {
    setGroups((prev) => prev.filter((g) => g.key !== key));
  }, []);

  const addChoice = useCallback(
    (groupKey: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.key === groupKey
            ? { ...g, choices: [...g.choices, { key: nextKey('choice'), name: '', price: '0' }] }
            : g
        )
      );
    },
    [nextKey]
  );

  const updateChoice = useCallback(
    (groupKey: string, choiceKey: string, field: 'name' | 'price', value: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.key === groupKey
            ? { ...g, choices: g.choices.map((c) => (c.key === choiceKey ? { ...c, [field]: value } : c)) }
            : g
        )
      );
    },
    []
  );

  const removeChoice = useCallback((groupKey: string, choiceKey: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.key === groupKey ? { ...g, choices: g.choices.filter((c) => c.key !== choiceKey) } : g
      )
    );
  }, []);

  return { groups, addGroup, updateGroup, removeGroup, addChoice, updateChoice, removeChoice };
}
