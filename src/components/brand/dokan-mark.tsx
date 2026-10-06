import { useId } from 'react';

/**
 * علامة دكان — the three overlapping shapes: violet #7047EB → purple #A244FF,
 * coral #FF9B53 → pink #FF698F, deep pink #E23B7B where they cross.
 *
 * Inlined rather than served through <img>/next/image on purpose:
 *   - next/image refuses SVG unless dangerouslyAllowSVG is switched on, and turning
 *     that on to draw a logo would let any SVG through the optimizer;
 *   - it costs no request and cannot flash before paint;
 *   - the gradient ids are namespaced per instance, because a page that shows the
 *     mark twice would otherwise declare the same two ids twice and the second one
 *     silently resolves to the first.
 *
 * Geometry is the master artwork (assets/brand/dokan-mark.svg, a 52x63 portrait box
 * that fills its own edges) placed in a padded 81x81 square, so the mark can be
 * dropped into any square slot at any size without looking clipped. Same padding
 * math as public/icon.svg.
 *
 * Decorative by default: pass `label` only where the mark IS the label (i.e. no
 * visible wordmark beside it), otherwise a screen reader would hear it twice.
 */
export function DokanMark({ className, label }: { className?: string; label?: string }) {
  // useId() gives ":r0:", and ":" is not legal inside an id or a url(#…) reference.
  const uid = useId().replace(/:/g, '');
  const violet = `dokan-violet-${uid}`;
  const coral = `dokan-coral-${uid}`;

  return (
    <svg
      viewBox="0 0 81 81"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g transform="translate(14.5 9)">
        <path
          d="M36.453 30.1162C36.4099 40.9181 31.8316 52.0699 22.3728 57.1429C15.7214 60.729 0 63.4841 0 51.8075C0 51.8075 0 8.38116 0 8.33743C0 1.86502 5.39885 -0.277871 10.7977 0.0282561C18.8312 0.465581 26.5192 4.27031 31.1838 11.2675C34.1639 15.7282 35.8052 21.1073 36.3235 26.5302C36.3667 27.7547 36.453 28.9354 36.453 30.1162Z"
          fill={`url(#${violet})`}
        />
        <path
          d="M51.3519 26.3114C50.4449 17.39 45.046 9.91175 37.574 5.4073C32.6071 2.38976 26.3876 1.64631 23.1483 7.6814C23.1483 7.72513 1.33692 48.3089 1.33692 48.3089C-0.563478 51.8512 -0.131567 54.7813 1.59607 57.1866C4.18751 60.7727 9.32721 62.3908 13.5167 62.8281C17.4039 63.2654 21.3343 62.8281 25.0919 61.9534C36.451 59.3295 46.5145 51.5014 49.9266 40.1309C51.2655 35.6702 51.827 30.9908 51.3519 26.3114Z"
          fill={`url(#${coral})`}
        />
        <path
          d="M22.3706 57.187C31.8294 52.0703 36.4077 40.9185 36.4508 30.1603C36.4508 28.9795 36.4077 27.7987 36.2781 26.6179C35.803 21.1951 34.1185 15.816 31.1384 11.3553C29.4971 8.86255 27.4672 6.80713 25.178 5.10156C24.4438 5.75755 23.7528 6.6322 23.1913 7.72551C23.1913 7.76924 1.37992 48.353 1.37992 48.353C-0.045378 50.9769 -0.131768 53.2948 0.602476 55.3065C0.602476 55.3502 0.64567 55.3939 0.64567 55.4377C0.68886 55.5251 0.732046 55.6563 0.775237 55.7438C0.818427 55.8313 0.818433 55.875 0.861624 55.9624C0.861624 56.0062 0.904817 56.0499 0.904817 56.0499C4.31689 62.6973 16.6695 60.2482 22.3706 57.187Z"
          fill="#E23B7B"
        />
      </g>
      <defs>
        <linearGradient
          id={violet}
          x1="18.1342"
          y1="17.837"
          x2="18.1342"
          y2="36.7233"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7047EB" />
          <stop offset="1" stopColor="#A244FF" />
        </linearGradient>
        <linearGradient
          id={coral}
          x1="43.5244"
          y1="9.6899"
          x2="17.3268"
          y2="59.8191"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FF9B53" />
          <stop offset="1" stopColor="#FF698F" />
        </linearGradient>
      </defs>
    </svg>
  );
}