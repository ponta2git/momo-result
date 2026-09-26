package momo.api.http

import org.http4s.{Request, Uri}

import momo.api.endpoints.UploadPaths

/** Use the same decoded segment boundaries as Tapir, including encoded route literals. */
private[http] object HttpRequestPaths:
  private val uploadSegments = List(UploadPaths.Api, UploadPaths.Uploads, UploadPaths.Images)

  def segments[F[_]](request: Request[F]): List[String] =
    val values = request.pathInfo.renderString.dropWhile(_ == '/').split("/").toList.map(Uri.decode(_))
    if values == List("") then Nil else values

  def isApi[F[_]](request: Request[F]): Boolean = segments(request).headOption.contains(UploadPaths.Api)

  def isImageUpload[F[_]](request: Request[F]): Boolean =
    HttpMethodPredicates.isPost(request.method) && segments(request) == uploadSegments
