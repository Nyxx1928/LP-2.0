import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { securityHeadersMiddleware } from "../lib/security-headers"

async function requestLogger(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  req.scope.resolve("logger").info(`${req.method} ${req.path}`)
  next()
}

export default defineMiddlewares({
  routes: [
    {
      // Apply security headers to ALL routes for maximum protection
      // This ensures every response includes security headers that protect against:
      // - Man-in-the-Middle attacks (HSTS)
      // - MIME sniffing attacks (X-Content-Type-Options)
      // - Clickjacking (X-Frame-Options)
      // - XSS attacks (X-XSS-Protection, Content-Security-Policy)
      // - Information leakage (Referrer-Policy)
      matcher: "*",
      middlewares: [securityHeadersMiddleware],
    },
    {
      matcher: "/store/custom",
      middlewares: [requestLogger],
    },
    {
      matcher: "/admin/custom",
      middlewares: [requestLogger],
    },
  ],
})
