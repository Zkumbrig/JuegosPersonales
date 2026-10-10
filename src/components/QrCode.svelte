<script lang="ts">
  import qrcode from 'qrcode-generator';

  let { value, size = 232 }: { value: string; size?: number } = $props();

  // Un único <path> con todos los módulos oscuros (agrupados por filas): ligero y nítido a cualquier tamaño.
  const model = $derived.by(() => {
    const qr = qrcode(0, 'M'); // tamaño automático, corrección de errores media
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) {
      let x = 0;
      while (x < n) {
        if (!qr.isDark(y, x)) { x++; continue; }
        const start = x;
        while (x < n && qr.isDark(y, x)) x++;
        d += `M${start} ${y}h${x - start}v1h${start - x}z`;
      }
    }
    return { n, d };
  });
  const quiet = 2; // margen blanco obligatorio para que las cámaras lo lean
</script>

<svg
  width={size}
  height={size}
  viewBox="{-quiet} {-quiet} {model.n + quiet * 2} {model.n + quiet * 2}"
  shape-rendering="crispEdges"
  role="img"
  aria-label="Código QR para unirse a la mesa"
>
  <rect x={-quiet} y={-quiet} width={model.n + quiet * 2} height={model.n + quiet * 2} fill="#ffffff" />
  <path d={model.d} fill="#0a0807" />
</svg>

<style>
  svg { display: block; border-radius: 14px; max-width: 100%; height: auto; }
</style>
