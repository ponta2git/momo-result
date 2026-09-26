package momo.api.logging

import scala.annotation.tailrec

object SafeLog:
  private val MaxCauseDepth = 32

  def throwableClasses(error: Throwable): String = causeChain(error).map(_.getClass.getName)
    .mkString(">")

  private[api] def causeChain(error: Throwable): List[Throwable] =
    @tailrec
    def loop(current: Option[Throwable], acc: List[Throwable]): List[Throwable] = current match
      case None => acc
      case Some(throwable) if acc.size >= MaxCauseDepth || acc.exists(_ eq throwable) => acc
      case Some(throwable) => loop(Option(throwable.getCause), throwable :: acc)
    loop(Some(error), Nil).reverse
