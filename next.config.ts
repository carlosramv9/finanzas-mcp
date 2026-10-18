import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita el encabezado X-Powered-By en las respuestas del endpoint.
  poweredByHeader: false,
};

export default nextConfig;
