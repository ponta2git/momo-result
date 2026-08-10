use super::{Category, Driver};

pub(super) struct Template {
    pub(super) heading: &'static str,
    pub(super) hypothesis: &'static str,
    pub(super) trigger: &'static str,
    pub(super) recommended: &'static str,
    pub(super) avoid: &'static str,
    pub(super) post_match: &'static str,
    pub(super) view: &'static str,
    pub(super) section_id: &'static str,
    pub(super) anchor_label: &'static str,
}

pub(super) const fn template(category: Category, driver: Driver) -> Template {
    match category {
        Category::Revenue => Template {
            heading: "収益先行後の目的地を優先する",
            hypothesis: "収益先行時は目的地0回で終えない。",
            trigger: "中盤以降、物件収益で上位だが目的地到着がないとき。",
            recommended: "追加収益より、目的地周辺への位置取り、到着、下位回避を優先する。",
            avoid: "収益トップだから安全と見て、目的地0回のまま終盤へ入ること。",
            post_match: "収益で上位だった試合について、目的地0回で終えたか、入賞できたかを振り返る。",
            view: "drivers",
            section_id: "revenue",
            anchor_label: "物件収益の根拠を見る",
        },
        Category::Destination => Template {
            heading: "目的地なしの展開で収益順位を戻す",
            hypothesis: "目的地なしの展開では、収益下位のまま終盤へ入らない。",
            trigger: "目的地到着がないまま中盤を過ぎ、物件収益順位も下がっているとき。",
            recommended: "目的地だけの一発逆転を待つ前に、物件収益順位を2位圏へ戻す。",
            avoid: "目的地を取れないまま、収益順位も下げた状態で終盤へ入ること。",
            post_match: "目的地0回だった試合で、物件収益順位を戻せたか、4位を避けられたかを振り返る。",
            view: "drivers",
            section_id: "destination",
            anchor_label: "目的地の根拠を見る",
        },
        Category::Assets => Template {
            heading: "低資産に沈む前に収益順位を戻す",
            hypothesis: "低資産に沈む前に収益順位を戻す。",
            trigger: "総資産が伸びず、物件収益順位も下がっているとき。",
            recommended: "目的地だけを追う前に、物件収益順位を2位圏へ戻す進行へ寄せる。",
            avoid: "収益下位のまま、目的地か上振れだけで巻き返そうとすること。",
            post_match: "低資産帯に入った試合で、収益順位を戻せたか、下位を避けられたかを振り返る。",
            view: "drivers",
            section_id: "assets",
            anchor_label: "資産分布の根拠を見る",
        },
        Category::PlayOrder => Template {
            heading: "苦手番手の遅れを早めに補正する",
            hypothesis: "苦手番手では収益順位の遅れを早めに補正する。",
            trigger: "苦手番手に入り、物件収益順位が下がったまま中盤へ入るとき。",
            recommended: "目的地を急ぐ前に、物件収益順位を2位圏へ戻す進行を優先する。",
            avoid: "番手差を無視して、収益下位のまま普段通りの優先順位で進め続けること。",
            post_match: "該当番手の試合で、中盤までに収益順位を補正できたかを振り返る。",
            view: "context",
            section_id: "play-order",
            anchor_label: "番手別の根拠を見る",
        },
        Category::Ginji => Template {
            heading: "銀次被害後に入賞圏を守る",
            hypothesis: "銀次被害後は収益順位を戻して入賞圏を守る。",
            trigger: "スリの銀次被害を受け、物件収益順位も下がっているとき。",
            recommended: "1位狙いを続ける前に、物件収益順位を2位圏へ戻して下位化を止める。",
            avoid: "被害前と同じ勝ち切り方に固執して、収益下位のまま終盤へ入ること。",
            post_match: "銀次被害があった試合で、収益順位を戻せたか、入賞圏を守れたかを振り返る。",
            view: "context",
            section_id: "ginji",
            anchor_label: "銀次被害の根拠を見る",
        },
        Category::Recovery => Template {
            heading: "前戦下位から2位圏へ戻す",
            hypothesis: "前戦下位の次戦は、下位連鎖を止める。",
            trigger: "前戦が3位以下で、次戦も中盤まで順位を戻せていないとき。",
            recommended: recovery_action(driver),
            avoid: "前戦の負けを一度に取り返そうとして、終盤の一発逆転だけを待つこと。",
            post_match: "前戦下位の次戦で、選んだ立て直し方により2位圏へ戻れたかを振り返る。",
            view: "flow",
            section_id: "recovery",
            anchor_label: "推移の根拠を見る",
        },
        Category::DestinationPositive => Template {
            heading: "目的地到着後も収益順位を守る",
            hypothesis: "目的地到着後も、収益下位のまま終盤へ入らない。",
            trigger: "目的地へ到着した後、物件収益順位が下がっているとき。",
            recommended: "到着直後の上振れだけに頼らず、物件収益順位を2位圏へ戻す進行を優先する。",
            avoid: "目的地へ着いたことで安全と見て、収益下位のまま終盤へ入ること。",
            post_match: "目的地へ到着した試合で、その後も収益順位と入賞圏を守れたかを振り返る。",
            view: "drivers",
            section_id: "destination",
            anchor_label: "目的地到着後の根拠を見る",
        },
        Category::Accident => Template {
            heading: "事故後は入賞圏の維持へ切り替える",
            hypothesis: "事故後は収益順位を戻して入賞圏を守る。",
            trigger: "銀次被害やマイナス駅の後、収益順位または目的地順位が下がったとき。",
            recommended: "勝ち切りを追い続ける前に、収益順位か目的地到着で2位圏へ戻す。",
            avoid: "事故前と同じ1位狙いに固執して、資産をさらに削る展開を続けること。",
            post_match: "事故があった試合で、収益順位または目的地を戻し、入賞圏を守れたかを振り返る。",
            view: "context",
            section_id: "incidents",
            anchor_label: "事故後の根拠を見る",
        },
    }
}

const fn recovery_action(driver: Driver) -> &'static str {
    match driver {
        Driver::Destination => {
            "1位狙いを続ける前に、目的地周辺への位置取りと1回到着で2位圏へ戻す。"
        }
        Driver::RevenueRank => "目的地だけを追い続ける前に、物件収益順位を2位圏へ戻す。",
        Driver::IncidentAvoidance => {
            "勝ち切りより、事故後に資産を残して入賞圏へ戻す進行を優先する。"
        }
        Driver::CardShop => "一発逆転を待つ前に、売り場経由を含む立て直しで2位圏へ戻す。",
    }
}

pub(super) const fn symptom_metric(category: Category) -> &'static str {
    match category {
        Category::Revenue => "playbook.revenue.winRateDifference",
        Category::Destination => "playbook.destination.rankScoreDifference",
        Category::Assets => "playbook.assets.rankScoreDifference",
        Category::PlayOrder => "playbook.playOrder.rankScoreDifference",
        Category::Ginji => "playbook.ginji.rankScoreDifference",
        Category::Recovery => "playbook.recovery.rankScoreDifference",
        Category::DestinationPositive => "playbook.destinationPositive.rankScoreDifference",
        Category::Accident => "playbook.accident.rankScoreDifference",
    }
}

impl Category {
    pub(super) const fn code(self) -> &'static str {
        match self {
            Self::Revenue => "revenue",
            Self::Destination => "destination",
            Self::Assets => "assets",
            Self::PlayOrder => "playOrder",
            Self::Ginji => "ginji",
            Self::Recovery => "recovery",
            Self::DestinationPositive => "destinationPositive",
            Self::Accident => "accident",
        }
    }

    pub(super) const fn common_heading(self) -> &'static str {
        match self {
            Self::Revenue => "収益先行後の目的地到着",
            Self::Destination => "目的地なしの展開での収益順位",
            Self::Assets => "低資産へ沈む前の収益順位",
            Self::PlayOrder => "苦手番手での序盤補正",
            Self::Ginji => "銀次被害後の入賞圏維持",
            Self::Recovery => "前戦下位からの戻し方",
            Self::DestinationPositive => "目的地到着後の収益順位",
            Self::Accident => "事故後の入賞圏維持",
        }
    }
}

impl Driver {
    pub(super) const fn metric_id(self) -> &'static str {
        match self {
            Self::RevenueRank => "playbook.driver.revenueRankScore",
            Self::Destination => "playbook.driver.destinationCount",
            Self::IncidentAvoidance => "playbook.driver.incidentAvoidanceScore",
            Self::CardShop => "playbook.driver.cardShopCount",
        }
    }

    pub(super) const fn label(self) -> &'static str {
        match self {
            Self::RevenueRank => "物件収益順位スコア差",
            Self::Destination => "目的地回数差",
            Self::IncidentAvoidance => "事故回避スコア差",
            Self::CardShop => "カード売り場回数差",
        }
    }

    pub(super) const fn unit(self) -> &'static str {
        match self {
            Self::RevenueRank | Self::IncidentAvoidance => "score",
            Self::Destination | Self::CardShop => "count",
        }
    }
}

pub(super) const fn action_connection(category: Category) -> f64 {
    match category {
        Category::PlayOrder | Category::Ginji => 0.75,
        Category::Revenue
        | Category::Destination
        | Category::Assets
        | Category::Recovery
        | Category::DestinationPositive
        | Category::Accident => 1.0,
    }
}
