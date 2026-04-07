import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"

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
      matcher: "/store/custom",
      middlewares: [requestLogger],
    },
    {
      matcher: "/admin/custom",
      middlewares: [requestLogger],
    },
  ],
})
