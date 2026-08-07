package momo.api.usecases.seriescomparison.engine

import scala.annotation.tailrec

private[seriescomparison] object DenseLinearSystem:
  private val PivotFloor = 0.000000000001

  def solve(
      matrix: Vector[Vector[Double]],
      rightHandSide: Vector[Double],
  ): Either[BradleyTerryFailure, Vector[Double]] =
    val dimension = rightHandSide.size
    val valid = dimension > 0 && matrix.size == dimension &&
      matrix.forall(row => row.size == dimension && row.forall(_.isFinite)) &&
      rightHandSide.forall(_.isFinite)
    if !valid then Left(BradleyTerryFailure.NumericalFailure)
    else
      val augmented = Array.tabulate(dimension, dimension + 1) { (row, column) =>
        if column == dimension then rightHandSide(row) else matrix(row)(column)
      }
      eliminate(augmented, dimension, 0).flatMap(_ => substitute(augmented, dimension))

  @tailrec
  private def eliminate(
      augmented: Array[Array[Double]],
      dimension: Int,
      pivotColumn: Int,
  ): Either[BradleyTerryFailure, Unit] =
    if pivotColumn >= dimension then Right(())
    else
      val pivotRow = (pivotColumn until dimension)
        .maxBy(row => math.abs(augmented(row)(pivotColumn)))
      if math.abs(augmented(pivotRow)(pivotColumn)) <= PivotFloor then
        Left(BradleyTerryFailure.NumericalFailure)
      else
        if pivotRow != pivotColumn then
          val temporary = augmented(pivotColumn)
          augmented(pivotColumn) = augmented(pivotRow)
          augmented(pivotRow) = temporary
        ((pivotColumn + 1) until dimension).foreach { candidateRow =>
          val factor = augmented(candidateRow)(pivotColumn) /
            augmented(pivotColumn)(pivotColumn)
          (pivotColumn to dimension).foreach { column =>
            augmented(candidateRow)(column) -= factor * augmented(pivotColumn)(column)
          }
        }
        eliminate(augmented, dimension, pivotColumn + 1)

  private def substitute(
      augmented: Array[Array[Double]],
      dimension: Int,
  ): Either[BradleyTerryFailure, Vector[Double]] =
    val solution = Array.fill(dimension)(0.0)

    @tailrec
    def loop(row: Int): Unit =
      if row >= 0 then
        val following = ((row + 1) until dimension)
          .map(column => augmented(row)(column) * solution(column)).sum
        solution(row) = (augmented(row)(dimension) - following) / augmented(row)(row)
        loop(row - 1)

    loop(dimension - 1)
    val result = solution.toVector
    if result.forall(_.isFinite) then Right(result)
    else Left(BradleyTerryFailure.NumericalFailure)

end DenseLinearSystem
