package momo.api.usecases

private[usecases] object SeriesComparisonReviewThresholds:
  val MainNormalSample = 20
  val MainConditionalSample = 8
  val ReferenceSample = 3
  val PriorWeight = 8.0
  val SignificantScoreDelta = 0.35
  val MinimumContrast = 0.14
  val MinimumActionDriverEffect = 0.30
  val ReferenceActionDriverEffect = 0.50
  val ActionDriverTieDelta = 0.08
  val RecoverySignificantRateDelta = 0.05
  val RecoveryMinimumDriverContrast = 0.30
  val BootstrapIterations = 96
  val CommonTopicPlayerCount = 3
  val CommonTopicLimit = 2

private[usecases] object StatsKernel:
  private val Epsilon = 0.000001

  def rate(count: Int, denominator: Int): Double =
    if denominator <= 0 then 0.0 else asDouble(count) / asDouble(denominator)

  def shrink(raw: Double, targetCount: Int): Double = raw * asDouble(targetCount) /
    (asDouble(targetCount) + SeriesComparisonReviewThresholds.PriorWeight)

  def standardizedDifference(a: List[Double], b: List[Double]): Double =
    if a.isEmpty || b.isEmpty then 0.0
    else
      val pooled = math.sqrt((variance(a) + variance(b)) / 2.0)
      if pooled <= Epsilon then 0.0 else (average(a) - average(b)) / pooled

  def cliffsDelta(a: List[Double], b: List[Double]): Double =
    if a.isEmpty || b.isEmpty then 0.0
    else
      val pairs =
        for
          left <- a
          right <- b
        yield if left > right then 1.0 else if left < right then -1.0 else 0.0
      average(pairs)

  def wilsonLower(success: Int, total: Int): Double =
    if total <= 0 then 0.0
    else
      val z = 1.96
      val n = asDouble(total)
      val phat = rate(success, total)
      val denominator = 1.0 + z * z / n
      val center = phat + z * z / (2.0 * n)
      val margin = z * math.sqrt((phat * (1.0 - phat) + z * z / (4.0 * n)) / n)
      clamp01((center - margin) / denominator)

  def logOddsRatio(successA: Int, totalA: Int, successB: Int, totalB: Int): Double =
    val a = asDouble(successA) + 0.5
    val b = asDouble(totalA - successA) + 0.5
    val c = asDouble(successB) + 0.5
    val d = asDouble(totalB - successB) + 0.5
    math.log((a / b) / (c / d))

  def percentile(values: List[Int], probability: Double): Option[Double] = values.sorted match
    case Nil => None
    case sorted =>
      val clamped = math.max(0.0, math.min(1.0, probability))
      val rank = clamped * asDouble(sorted.size - 1)
      val lower = math.floor(rank).toInt
      val upper = math.ceil(rank).toInt
      val weight = rank - asDouble(lower)
      Some(asDouble(sorted(lower)) + (asDouble(sorted(upper)) - asDouble(sorted(lower))) * weight)

  def clamp01(value: Double): Double = math.max(0.0, math.min(1.0, value))

  private def average(values: List[Double]): Double = values match
    case Nil => 0.0
    case nonEmpty => nonEmpty.sum / asDouble(nonEmpty.size)

  private def variance(values: List[Double]): Double =
    if values.size <= 1 then 0.0
    else
      val mean = average(values)
      values.map(value => math.pow(value - mean, 2)).sum / asDouble(values.size - 1)

  private def asDouble(value: Int): Double = value * 1.0

private[usecases] final case class RecoveryText(
    actionHypothesis: String,
    triggerCondition: String,
    recommendedAction: String,
    avoidAction: String,
    postMatchCheck: String,
)

private[usecases] object SeriesComparisonReviewText:
  def commonTopicText(category: String, count: Int): (String, String, String) =
    category match
      case "revenue" => (
          "収益先行後の勝ち切りが共通論点です",
          s"${count}人に物件収益先行時の候補が出ています。個人カードには、4人内で差が強い人だけを残しています。",
          "収益で上回った試合は、目的地到着、事故後の入賞維持、終盤の下位回避のどれが順位差に近いかを振り返ります。",
        )
      case "destination" => (
          "目的地なし展開の下位回避が共通論点です",
          s"${count}人に目的地0回時の候補が出ています。個人カードには、落ち込みが相対的に大きい人だけを残しています。",
          "目的地が取れない試合は、収益順位、事故回避、売り場経由のどれで2位圏へ戻せたかを見ます。",
        )
      case "destinationPositive" => (
          "目的地後の収益維持が共通論点です",
          s"${count}人に目的地到着後の候補が出ています。個人カードには、差が相対的に強い人だけを残しています。",
          "目的地を取れた試合は、その後も収益順位、事故回避、次の到着準備のどれを保てたかを振り返ります。",
        )
      case "accident" => (
          "事故後の入賞圏維持が共通論点です",
          s"${count}人に事故後の候補が出ています。個人カードには、落ち込みや戻し方が相対的に強い人だけを残しています。",
          "銀次被害やマイナス駅があった試合は、収益順位、目的地順位、追加事故回避のどれで入賞圏へ戻せたかを振り返ります。",
        )
      case "assets" => (
          "低資産帯に入る前の切り替えが共通論点です",
          s"${count}人に低資産帯の候補が出ています。個人カードには、低資産帯率が4人内で目立つ人だけを残しています。",
          "総資産が伸びない試合は、収益順位、目的地不足、事故のどれで沈んだかを分けて振り返ります。",
        )
      case "playOrder" => (
          "苦手番手の初動補正が共通論点です",
          s"${count}人に番手差の候補が出ています。個人カードには、番手差が相対的に大きい人だけを残しています。",
          "苦手番手では、収益順位、目的地、事故回避のどれを早めに補正するかを決めます。",
        )
      case "ginji" => (
          "銀次被害後の方針転換が共通論点です",
          s"${count}人に銀次被害後の候補が出ています。個人カードには、被害時の落ち込みが相対的に大きい人だけを残しています。",
          "銀次被害後は、収益順位、目的地順位、追加事故回避のどれで入賞圏へ戻せたかを振り返ります。",
        )
      case "recovery" => (
          "下位後の戻し方が共通論点です",
          s"${count}人に前戦下位後の候補が出ています。個人カードには、復帰ドライバーが相対的に強い人だけを残しています。",
          "前戦下位の次戦は、目的地到着、収益基盤、事故後の資産維持のどれで2位圏へ戻せたかを振り返ります。",
        )
      case _ => (
          "複数人に共通する論点があります",
          s"${count}人に同じカテゴリの候補が出ています。個人カードには、相対的に強い候補だけを残しています。",
          "共通論点は全員分を繰り返さず、個人差が出た候補だけをカード化します。",
        )

  def destinationPositiveText(kind: String): RecoveryText = kind match
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "目的地を取れた後は、追加事故で入賞圏を崩さない。",
        triggerCondition = "目的地到着後、銀次被害やマイナス駅で資産差が詰まったとき。",
        recommendedAction = "次の目的地だけを急がず、追加事故を避けて入賞圏を守る進行を優先する。",
        avoidAction = "目的地を取れた安心で、事故後も勝ち切り方を変えずに終盤へ入ること。",
        postMatchCheck = "次回、目的地を取れた試合を対象に、事故後も入賞圏を守れたかを振り返る。",
      )
    case "cardShopFollowup" => RecoveryText(
        actionHypothesis = "目的地を取れた後は、売り場経由で次の到着準備を作る。",
        triggerCondition = "目的地到着後、次の目的地が遠く売り場に寄れるとき。",
        recommendedAction = "直行だけに寄せず、売り場経由で移動や妨害の選択肢を整える。",
        avoidAction = "目的地を取った後、次の到着準備を作らないまま終盤へ入ること。",
        postMatchCheck = "次回、目的地を取れた試合を対象に、売り場経由で次の到着準備を作れたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "目的地を取れた後も、収益順位を落としたまま終盤へ入らない。",
        triggerCondition = "目的地到着後、次の目的地か収益作りかで迷うとき。",
        recommendedAction = "次の到着だけに寄せず、物件収益順位を2位圏で保つ進行を優先する。",
        avoidAction = "目的地を取れた安心で、収益順位を落としたまま終盤へ入ること。",
        postMatchCheck = "次回、目的地を取れた試合を対象に、物件収益順位を保ったまま入賞圏に残れたかを振り返る。",
      )

  def accidentAnyText(kind: String): RecoveryText = kind match
    case "destinationRecovery" => RecoveryText(
        actionHypothesis = "事故後は目的地順位を戻して入賞圏を守る。",
        triggerCondition = "銀次被害やマイナス駅の後も、目的地到着で順位圏へ戻せる余地があるとき。",
        recommendedAction = "被害額だけを見ず、目的地周辺への位置取りで入賞圏へ戻す。",
        avoidAction = "事故後に目的地到着による順位回復を捨て、逆転待ちだけで終盤へ入ること。",
        postMatchCheck = "次回、事故があった試合で、目的地順位を戻して入賞圏を守れたかを振り返る。",
      )
    case "avoidFurtherMinus" => RecoveryText(
        actionHypothesis = "事故後は追加事故を避けて下位連鎖を止める。",
        triggerCondition = "銀次被害やマイナス駅の後、さらに資産差が広がりそうなとき。",
        recommendedAction = "1位狙いを続ける前に、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "事故後も同じ勝ち切り方に固執して、資産を削る展開を続けること。",
        postMatchCheck = "次回、事故があった試合で、追加事故を避けて下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "事故後は勝ち切り継続より、収益順位を戻して入賞圏を守る。",
        triggerCondition = "銀次被害やマイナス駅の後、物件収益順位も下がっているとき。",
        recommendedAction = "1位狙いを続ける前に、物件収益順位を2位圏へ戻して下位化を止める。",
        avoidAction = "事故前と同じ勝ち切り方に固執して、収益下位のまま終盤へ入ること。",
        postMatchCheck = "次回、事故があった試合で、物件収益順位を戻して入賞圏を守れたかを振り返る。",
      )

  def destinationPositiveDriverLabel(kind: String): String = kind match
    case "accidentAvoidance" => "目的地後の事故回避差"
    case "cardShopFollowup" => "目的地後の売り場差"
    case _ => "目的地後の収益順位差"

  def accidentAnyDriverLabel(kind: String): String = kind match
    case "destinationRecovery" => "事故後の目的地順位差"
    case "avoidFurtherMinus" => "事故後の追加事故回避差"
    case _ => "事故後の収益順位差"

  def destinationZeroText(kind: String): RecoveryText = kind match
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "目的地なしで事故が重なったら下位連鎖を止める。",
        triggerCondition = "目的地到着がないまま、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "目的地を追い続けるより、追加事故を避けて入賞圏に戻す進行を優先する。",
        avoidAction = "目的地を取れない焦りで、被害後も大きな逆転狙いだけを続けること。",
        postMatchCheck = "次回、目的地0回だった試合を対象に、事故後に下位連鎖を止められたかを振り返る。",
      )
    case "cardShopRoute" => RecoveryText(
        actionHypothesis = "目的地なしの展開では、売り場経由で到着準備を作る。",
        triggerCondition = "目的地到着がないまま中盤を過ぎ、カード売り場に寄れるとき。",
        recommendedAction = "直行で届かないなら、売り場経由で移動や妨害の選択肢を整えて次の到着機会を作る。",
        avoidAction = "目的地が遠いまま、売り場にも寄らず終盤の一発逆転だけを待つこと。",
        postMatchCheck = "次回、目的地0回だった試合を対象に、売り場経由で到着準備を作れたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "目的地なしの展開では、収益下位のまま終盤へ入らない。",
        triggerCondition = "目的地到着がないまま中盤を過ぎ、物件収益順位も下がっているとき。",
        recommendedAction = "目的地だけの一発逆転を待つ前に、物件収益順位を2位圏へ戻す。",
        avoidAction = "目的地を取れないまま、収益順位も下げた状態で終盤へ入ること。",
        postMatchCheck = "次回、目的地0回だった試合を対象に、物件収益順位を戻せたか、4位を避けられたかを振り返る。",
      )

  def lowAssetText(kind: String): RecoveryText = kind match
    case "destinationShortage" => RecoveryText(
        actionHypothesis = "低資産に沈む前に目的地到着で戻す。",
        triggerCondition = "総資産が伸びず、目的地回数でも遅れていると感じるとき。",
        recommendedAction = "高収益だけで巻き返す前に、目的地周辺への位置取りと1回到着を優先する。",
        avoidAction = "目的地も資産も遅れたまま、高収益だけで巻き返そうとすること。",
        postMatchCheck = "次回、総資産が伸びなかった試合で、目的地到着を作れたかを振り返る。",
      )
    case "ginjiBias" | "minusBias" => RecoveryText(
        actionHypothesis = "低資産に沈む前に事故連鎖を止める。",
        triggerCondition = "総資産が伸びず、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "大きな上振れ狙いより、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "低資産のまま、事故後も同じ勝ち切り方に固執すること。",
        postMatchCheck = "次回、総資産が伸びなかった試合で、事故後に下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "低資産に沈む前に収益順位を戻す。",
        triggerCondition = "総資産が伸びず、物件収益順位も下がっているとき。",
        recommendedAction = "目的地だけを追う前に、物件収益順位を2位圏へ戻す進行へ寄せる。",
        avoidAction = "収益下位のまま、目的地か上振れだけで巻き返そうとすること。",
        postMatchCheck = "次回、総資産が伸びなかった試合で、物件収益順位を戻せたかを振り返る。",
      )

  def playOrderText(kind: String, order: Int): RecoveryText = kind match
    case "destinationCount" => RecoveryText(
        actionHypothesis = "苦手番手では目的地の遅れを早めに補正する。",
        triggerCondition = s"${order}番手に入り、目的地到着が遅れているとき。",
        recommendedAction = "普段より早く目的地周辺への位置取りを優先し、到着なしで終盤へ入らない。",
        avoidAction = "番手差を無視して普段通りの優先順位で進め続けること。",
        postMatchCheck = s"次回、${order}番手だった試合で、目的地回数を戻せたかを振り返る。",
      )
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "苦手番手では事故連鎖を早めに止める。",
        triggerCondition = s"${order}番手に入り、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "普段の勝ち筋を急ぐ前に、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "番手差と事故を無視して、普段通りの勝ち切り方へ寄せ続けること。",
        postMatchCheck = s"次回、${order}番手だった試合で、事故後に下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "苦手番手では収益順位の遅れを早めに補正する。",
        triggerCondition = s"${order}番手に入り、物件収益順位が下がったまま中盤へ入るとき。",
        recommendedAction = "目的地を急ぐ前に、物件収益順位を2位圏へ戻す進行を優先する。",
        avoidAction = "番手差を無視して、収益下位のまま普段通りの優先順位で進め続けること。",
        postMatchCheck = s"次回、${order}番手だった試合で、物件収益順位を戻せたかを振り返る。",
      )

  def ginjiText(kind: String): RecoveryText = kind match
    case "destinationRank" => RecoveryText(
        actionHypothesis = "銀次被害後は目的地で順位圏を戻しに行く。",
        triggerCondition = "スリの銀次被害後も、目的地到着で順位圏へ戻せる余地があるとき。",
        recommendedAction = "被害額だけを見ず、目的地周辺への位置取りで入賞圏へ戻す。",
        avoidAction = "被害額だけで諦めて、目的地到着による順位回復を捨てること。",
        postMatchCheck = "次回、銀次被害があった試合で、目的地順位を戻して入賞圏へ戻れたかを振り返る。",
      )
    case "accidentAvoidance" => RecoveryText(
        actionHypothesis = "銀次被害後は追加事故を避けて下位連鎖を止める。",
        triggerCondition = "スリの銀次被害後に、さらにマイナス駅などで資産差が広がりそうなとき。",
        recommendedAction = "1位狙いを続ける前に、追加事故を避けて入賞圏へ戻す進行を優先する。",
        avoidAction = "被害後も同じ勝ち切り方に固執して、追加事故を受ける展開を続けること。",
        postMatchCheck = "次回、銀次被害があった試合で、追加事故を避けて下位連鎖を止められたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "銀次被害後は収益順位を戻して入賞圏を守る。",
        triggerCondition = "スリの銀次被害を受け、物件収益順位も下がっているとき。",
        recommendedAction = "1位狙いを続ける前に、物件収益順位を2位圏へ戻して下位化を止める。",
        avoidAction = "被害前と同じ勝ち切り方に固執して、収益下位のまま終盤へ入ること。",
        postMatchCheck = "次回、銀次被害があった試合で、物件収益順位を戻して入賞圏を守れたかを振り返る。",
      )

  def recoveryText(kind: String): RecoveryText = kind match
    case "destination" => RecoveryText(
        actionHypothesis = "前戦下位の次戦は、目的地0回で終盤へ入らない。",
        triggerCondition = "前戦が3位以下で、次戦も中盤まで目的地到着がないとき。",
        recommendedAction = "1位狙いを続ける前に、目的地周辺への位置取りと1回到着で2位圏へ戻す。",
        avoidAction = "前戦の負けを取り返そうとして、目的地0回のまま終盤の一発逆転だけを待つこと。",
        postMatchCheck = "次回、前戦下位後の試合を対象に、目的地0回で終盤へ入ったか、入賞圏へ戻せたかを振り返る。",
      )
    case "revenue" => RecoveryText(
        actionHypothesis = "前戦下位の次戦は、収益下位のまま終盤へ入らない。",
        triggerCondition = "前戦が3位以下で、目的地が遠く物件収益順位も下がっていると感じるとき。",
        recommendedAction = "目的地だけを追い続ける前に、物件収益順位を2位圏へ戻す。",
        avoidAction = "目的地が遠いまま、収益も作らず逆転待ちで終盤へ入ること。",
        postMatchCheck = "次回、前戦下位後の試合を対象に、物件収益順位を戻せたか、入賞圏へ戻せたかを振り返る。",
      )
    case _ => RecoveryText(
        actionHypothesis = "前戦下位の次戦は、下位連鎖を止める。",
        triggerCondition = "前戦が3位以下で、銀次被害やマイナス駅で資産差が広がったとき。",
        recommendedAction = "勝ち切りより、事故後に資産を残して入賞圏へ戻す進行を優先する。",
        avoidAction = "被害後も1位狙いのまま、資産を削る展開を続けること。",
        postMatchCheck = "次回、前戦下位後に事故が重なった試合で、資産を残して下位連鎖を止められたかを振り返る。",
      )

  def defaultPlainReason(category: String): String = category match
    case "revenue" =>
      "収益で先行した試合でも、目的地到着や事故後の立て直しで順位差が分かれています。"
    case "destinationPositive" =>
      "目的地を取れた試合でも、入賞できた試合は物件収益順位を保てている傾向があります。"
    case "destination" =>
      "目的地が取れない試合では、収益順位や事故回避の差が入賞圏への戻り方に出ています。"
    case "accident" =>
      "事故があった試合では、入賞できた試合ほど収益順位を戻せている傾向があります。"
    case "assets" =>
      "資産が沈む試合では、収益順位、目的地、事故回避のどこで遅れたかが分岐になります。"
    case "playOrder" =>
      "苦手番手では、普段より早く収益順位や目的地の遅れを補正する必要が出ています。"
    case "ginji" =>
      "銀次被害後は、被害額だけでなく収益順位や目的地順位の戻し方が分岐になります。"
    case "recovery" =>
      "前戦下位の次戦では、入賞圏へ戻せた試合ほど収益順位や目的地順位を立て直せています。"
    case _ =>
      "選択範囲の試合で、次回に持ち帰れる差が出ています。"

  def defaultEvidenceStrength(status: String, score: Double): String =
    if status == "ok" && score >= 0.08 then "strong"
    else if status == "ok" then "verify"
    else if status == "reference" then "verify"
    else "diagnostic"
