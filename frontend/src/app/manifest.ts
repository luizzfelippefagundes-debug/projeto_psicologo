import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Consultório",
    short_name: "Consultório",
    description: "Painel de agendamento e gestão do consultório",
    start_url: "/",
    display: "standalone",
    background_color: "#ede6e1",
    theme_color: "#a8768a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
