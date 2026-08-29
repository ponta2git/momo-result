package momo.api.adapters.postgres

import munit.FunSuite

final class PostgresSeriesAnalysisMutationOpsSpec extends FunSuite:
  test("validation contract identities keep absence distinct from every present value"):
    val absent = PostgresSeriesAnalysisMutationOps.validationContractIdentity(None)
    val literalNone = PostgresSeriesAnalysisMutationOps.validationContractIdentity(Some("none"))
    val current = PostgresSeriesAnalysisMutationOps.validationContractIdentity(
      Some(SeriesAnalysisArtifactSupport.ValidationContractId)
    )

    assertEquals(Set(absent, literalNone, current).size, 3)

end PostgresSeriesAnalysisMutationOpsSpec
