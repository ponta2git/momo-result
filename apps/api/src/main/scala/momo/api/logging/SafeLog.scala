package momo.api.logging

import scala.annotation.tailrec

object SafeLog:
  def throwableClasses(error: Throwable): String =
    @tailrec
    def loop(current: Option[Throwable], acc: Vector[String]): Vector[String] = current match
      case None => acc
      case Some(throwable) => loop(Option(throwable.getCause), acc :+ throwable.getClass.getName)
    loop(Some(error), Vector.empty).mkString(">")
