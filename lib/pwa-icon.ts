type MarcaSalon = { name: string; logo_url: string | null };

export function urlIconoSalon(slug: string, size: 32 | 180 | 192 | 512, salon: MarcaSalon) {
  // Cambiar el nombre o el logo cambia la clave de caché. La página y los
  // manifests tienen que usar la misma URL exacta para cada tamaño.
  const marca = `${salon.logo_url ?? ""}|${salon.name}`;
  let version = 5381;
  for (let i = 0; i < marca.length; i++) {
    version = ((version * 33) ^ marca.charCodeAt(i)) >>> 0;
  }
  return `/${encodeURIComponent(slug)}/pwa-icon?size=${size}&v=${version.toString(36)}`;
}
