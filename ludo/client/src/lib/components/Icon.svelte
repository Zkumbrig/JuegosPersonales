<script lang="ts">
  // Iconos de trazo en una rejilla de 24×24.
  const paths = {
    crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z',
    copy: 'M9 9h11v11H9z M5 15V4h11',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    share: 'M12 3v12 M7 8l5-5 5 5 M5 14v6h14v-6',
    bot: 'M5 8h14v11H5z M12 8V4 M9 13h.01 M15 13h.01 M3 12v3 M21 12v3',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    x: 'M6 6l12 12 M18 6L6 18',
    sound: 'M4 9v6h4l5 4V5L8 9H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11',
    mute: 'M4 9v6h4l5 4V5L8 9H4z M17 9l5 6 M22 9l-5 6',
    exit: 'M10 4H5v16h5 M15 8l4 4-4 4 M9 12h10',
    play: 'M7 4l13 8-13 8V4z',
    users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1 M17 11a3 3 0 1 0 0-5 M21 20v-1a4 4 0 0 0-3-3.9',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
    check: 'M5 12l5 5 9-10',
    plus: 'M12 5v14 M5 12h14',
    trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4z M8 6H4v2a3 3 0 0 0 4 3 M16 6h4v2a3 3 0 0 1-4 3 M12 13v4 M8 20h8 M10 17h4',
    wifi: 'M2 9a15 15 0 0 1 20 0 M5.5 12.5a10 10 0 0 1 13 0 M9 16a5 5 0 0 1 6 0 M12 19.5h.01',
    help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17h.01',
  } as const;

  type Props = { name: keyof typeof paths; size?: number };
  let { name, size = 20 }: Props = $props();
  const filled = $derived(name === 'play');
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
