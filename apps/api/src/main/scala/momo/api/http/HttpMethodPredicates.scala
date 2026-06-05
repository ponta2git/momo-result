package momo.api.http

import org.http4s.Method

private[http] object HttpMethodPredicates:
  private val MutatingMethodNames =
    Set(Method.POST.name, Method.PUT.name, Method.PATCH.name, Method.DELETE.name)

  def isGet(method: Method): Boolean = method.name == Method.GET.name

  def isPost(method: Method): Boolean = method.name == Method.POST.name

  def isMutating(method: Method): Boolean = MutatingMethodNames.contains(method.name)
