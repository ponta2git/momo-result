export interface paths {
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHealthz"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz/details": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHealthzDetails"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Start Discord OAuth login. */
        get: operations["getApiAuthLogin"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Complete Discord OAuth login. */
        get: operations["getApiAuthCallback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiAuthLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAuthMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/uploads/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiUploadsImages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ocr-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiOcr-jobs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ocr-jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiOcr-jobsJobid"];
        put?: never;
        post?: never;
        delete: operations["deleteApiOcr-jobsJobid"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ocr-drafts/{draftId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiOcr-draftsDraftid"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/ocr-drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiOcr-drafts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiExportsMatches"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/held-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiHeld-events"];
        put?: never;
        post: operations["postApiHeld-events"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/held-events/{heldEventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiHeld-eventsHeldeventid"];
        put?: never;
        post?: never;
        delete: operations["deleteApiHeld-eventsHeldeventid"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/match-drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiMatch-drafts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/match-drafts/{draftId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatch-draftsDraftid"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["patchApiMatch-draftsDraftid"];
        trace?: never;
    };
    "/api/match-drafts/{draftId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiMatch-draftsDraftidCancel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/match-drafts/{draftId}/source-images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatch-draftsDraftidSource-images"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/match-drafts/{draftId}/source-images.zip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatch-draftsDraftidSource-images.zip"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/match-drafts/{draftId}/source-images/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatch-draftsDraftidSource-imagesKind"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatches"];
        put?: never;
        post: operations["postApiMatches"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/matches/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatchesSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/matches/{matchId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMatchesMatchid"];
        put: operations["putApiMatchesMatchid"];
        post?: never;
        delete: operations["deleteApiMatchesMatchid"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/matches/{matchId}/note": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["putApiMatchesMatchidNote"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparison"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonReview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/drilldown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonDrilldown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/v2/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonV2Options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/v2/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonV2Status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/v2/aggregate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonV2Aggregate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/v2/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonV2Review"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/v2/drilldown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonV2Drilldown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/analytics/series-comparison/v2/match-context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAnalyticsSeries-comparisonV2Match-context"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/series-analysis/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAdminSeries-analysisOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/series-analysis/recalculations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiAdminSeries-analysisRecalculations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/series-analysis/recalculations/all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["postApiAdminSeries-analysisRecalculationsAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/game-titles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiGame-titles"];
        put?: never;
        post: operations["postApiGame-titles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/game-titles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteApiGame-titlesId"];
        options?: never;
        head?: never;
        patch: operations["patchApiGame-titlesId"];
        trace?: never;
    };
    "/api/map-masters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMap-masters"];
        put?: never;
        post: operations["postApiMap-masters"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/map-masters/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteApiMap-mastersId"];
        options?: never;
        head?: never;
        patch: operations["patchApiMap-mastersId"];
        trace?: never;
    };
    "/api/season-masters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiSeason-masters"];
        put?: never;
        post: operations["postApiSeason-masters"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/season-masters/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteApiSeason-mastersId"];
        options?: never;
        head?: never;
        patch: operations["patchApiSeason-mastersId"];
        trace?: never;
    };
    "/api/incident-masters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiIncident-masters"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/member-aliases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiMember-aliases"];
        put?: never;
        post: operations["postApiMember-aliases"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/member-aliases/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteApiMember-aliasesId"];
        options?: never;
        head?: never;
        patch: operations["patchApiMember-aliasesId"];
        trace?: never;
    };
    "/api/admin/login-accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getApiAdminLogin-accounts"];
        put?: never;
        post: operations["postApiAdminLogin-accounts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/login-accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["patchApiAdminLogin-accountsAccountid"];
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AuthMeResponse */
        AuthMeResponse: {
            accountId: string;
            displayName: string;
            isAdmin: boolean;
            memberId?: string;
            csrfToken?: string;
        };
        /** CancelMatchDraftResponse */
        CancelMatchDraftResponse: {
            matchDraftId: string;
            status: string;
        };
        /** CancelOcrJobResponse */
        CancelOcrJobResponse: {
            jobId: string;
            status: string;
        };
        /** ConfirmMatchDraftIds */
        ConfirmMatchDraftIds: {
            totalAssets?: string;
            revenue?: string;
            incidentLog?: string;
        };
        /** ConfirmMatchRequest */
        ConfirmMatchRequest: {
            matchDraftId?: string;
            heldEventId: string;
            /** Format: int32 */
            matchNoInEvent: number;
            gameTitleId: string;
            seasonMasterId: string;
            ownerMemberId: string;
            mapMasterId: string;
            playedAt: string;
            draftIds: components["schemas"]["ConfirmMatchDraftIds"];
            players?: components["schemas"]["PlayerResultRequest"][];
            noteBody?: string;
        };
        /** ConfirmMatchResponse */
        ConfirmMatchResponse: {
            matchId: string;
            heldEventId: string;
            /** Format: int32 */
            matchNoInEvent: number;
            createdAt: string;
        };
        /** CreateGameTitleRequest */
        CreateGameTitleRequest: {
            id: string;
            name: string;
            layoutFamily: string;
        };
        /** CreateHeldEventRequest */
        CreateHeldEventRequest: {
            heldAt: string;
        };
        /** CreateLoginAccountRequest */
        CreateLoginAccountRequest: {
            discordUserId: string;
            displayName: string;
            playerMemberId?: string;
            loginEnabled: boolean;
            isAdmin: boolean;
        };
        /** CreateMapMasterRequest */
        CreateMapMasterRequest: {
            id: string;
            gameTitleId: string;
            name: string;
        };
        /** CreateMatchDraftRequest */
        CreateMatchDraftRequest: {
            heldEventId?: string;
            /** Format: int32 */
            matchNoInEvent?: number;
            gameTitleId?: string;
            layoutFamily?: string;
            seasonMasterId?: string;
            ownerMemberId?: string;
            mapMasterId?: string;
            playedAt?: string;
            status?: string;
        };
        /** CreateMemberAliasRequest */
        CreateMemberAliasRequest: {
            memberId: string;
            alias: string;
        };
        /** CreateOcrJobRequest */
        CreateOcrJobRequest: {
            imageId: string;
            /** @description Must be total_assets, revenue, or incident_log. The legacy auto value is not accepted. */
            requestedScreenType: string;
            ocrHints?: components["schemas"]["OcrJobHintsRequest"];
            matchDraftId?: string;
        };
        /** CreateOcrJobResponse */
        CreateOcrJobResponse: {
            jobId: string;
            draftId: string;
            status: string;
        };
        /** CreateSeasonMasterRequest */
        CreateSeasonMasterRequest: {
            id: string;
            gameTitleId: string;
            name: string;
        };
        /** DeleteHeldEventResponse */
        DeleteHeldEventResponse: {
            heldEventId: string;
            deleted: boolean;
        };
        /** DeleteMasterResponse */
        DeleteMasterResponse: {
            id: string;
            deleted: boolean;
        };
        /** DeleteMatchResponse */
        DeleteMatchResponse: {
            matchId: string;
            deleted: boolean;
        };
        /** GameTitleListResponse */
        GameTitleListResponse: {
            items?: components["schemas"]["GameTitleResponse"][];
        };
        /** GameTitleResponse */
        GameTitleResponse: {
            id: string;
            name: string;
            layoutFamily: string;
            /** Format: int32 */
            displayOrder: number;
            createdAt: string;
        };
        /** HealthDetailsResponse */
        HealthDetailsResponse: {
            status: string;
            database: string;
            redis: string;
            ocrAdmission: string;
        };
        /** HealthResponse */
        HealthResponse: {
            status: string;
        };
        /** HeldEventDetailResponse */
        HeldEventDetailResponse: {
            id: string;
            heldAt: string;
            /** Format: int32 */
            matchCount: number;
            /** Format: int32 */
            draftCount: number;
            /** Format: int32 */
            nextMatchNo: number;
            matches?: components["schemas"]["HeldEventMatchResponse"][];
            drafts?: components["schemas"]["HeldEventDraftResponse"][];
        };
        /** HeldEventDraftResponse */
        HeldEventDraftResponse: {
            matchDraftId: string;
            status: string;
            /** Format: int32 */
            matchNoInEvent?: number;
            gameTitleId?: string;
            seasonMasterId?: string;
            mapMasterId?: string;
            playedAt?: string;
            updatedAt: string;
        };
        /** HeldEventListResponse */
        HeldEventListResponse: {
            items?: components["schemas"]["HeldEventResponse"][];
            pagination: components["schemas"]["PaginationResponse"];
            /** Format: int32 */
            totalMatchCount: number;
        };
        /** HeldEventMatchResponse */
        HeldEventMatchResponse: {
            matchId: string;
            /** Format: int32 */
            matchNoInEvent: number;
            gameTitleId: string;
            seasonMasterId: string;
            ownerMemberId: string;
            mapMasterId: string;
            playedAt: string;
            players?: components["schemas"]["HeldEventPlayerResultResponse"][];
            noteBody?: string;
        };
        /** HeldEventPlayerResultResponse */
        HeldEventPlayerResultResponse: {
            memberId: string;
            /** Format: int32 */
            playOrder: number;
            /** Format: int32 */
            rank: number;
            /** Format: int32 */
            totalAssetsManYen: number;
            /** Format: int32 */
            revenueManYen: number;
        };
        /** HeldEventResponse */
        HeldEventResponse: {
            id: string;
            heldAt: string;
            /** Format: int32 */
            matchCount: number;
            /** Format: int32 */
            draftCount: number;
            /** Format: int32 */
            nextMatchNo: number;
        };
        /** IncidentCountsRequest */
        IncidentCountsRequest: {
            /** Format: int32 */
            destination: number;
            /** Format: int32 */
            plusStation: number;
            /** Format: int32 */
            minusStation: number;
            /** Format: int32 */
            cardStation: number;
            /** Format: int32 */
            cardShop: number;
            /** Format: int32 */
            suriNoGinji: number;
        };
        /** IncidentCountsResponse */
        IncidentCountsResponse: {
            /** Format: int32 */
            destination: number;
            /** Format: int32 */
            plusStation: number;
            /** Format: int32 */
            minusStation: number;
            /** Format: int32 */
            cardStation: number;
            /** Format: int32 */
            cardShop: number;
            /** Format: int32 */
            suriNoGinji: number;
        };
        /** IncidentMasterListResponse */
        IncidentMasterListResponse: {
            items?: components["schemas"]["IncidentMasterResponse"][];
        };
        /** IncidentMasterResponse */
        IncidentMasterResponse: {
            id: string;
            key: string;
            displayName: string;
            /** Format: int32 */
            displayOrder: number;
        };
        /** LoginAccountListResponse */
        LoginAccountListResponse: {
            items?: components["schemas"]["LoginAccountResponse"][];
        };
        /** LoginAccountResponse */
        LoginAccountResponse: {
            accountId: string;
            discordUserId: string;
            displayName: string;
            playerMemberId?: string;
            loginEnabled: boolean;
            isAdmin: boolean;
            createdAt: string;
            updatedAt: string;
        };
        /** MapMasterListResponse */
        MapMasterListResponse: {
            items?: components["schemas"]["MapMasterResponse"][];
        };
        /** MapMasterResponse */
        MapMasterResponse: {
            id: string;
            gameTitleId: string;
            name: string;
            /** Format: int32 */
            displayOrder: number;
            createdAt: string;
        };
        /** MatchDetailResponse */
        MatchDetailResponse: {
            matchId: string;
            heldEventId: string;
            /** Format: int32 */
            matchNoInEvent: number;
            gameTitleId: string;
            layoutFamily: string;
            seasonMasterId: string;
            ownerMemberId: string;
            mapMasterId: string;
            playedAt: string;
            totalAssetsDraftId?: string;
            revenueDraftId?: string;
            incidentLogDraftId?: string;
            players?: components["schemas"]["PlayerResultResponse"][];
            createdByAccountId: string;
            createdByMemberId?: string;
            createdAt: string;
            note: components["schemas"]["MatchNoteResponse"];
        };
        /** MatchDraftDetailResponse */
        MatchDraftDetailResponse: {
            matchDraftId: string;
            status: string;
            confirmedMatchId?: string;
            heldEventId?: string;
            /** Format: int32 */
            matchNoInEvent?: number;
            gameTitleId?: string;
            layoutFamily?: string;
            seasonMasterId?: string;
            ownerMemberId?: string;
            mapMasterId?: string;
            playedAt?: string;
            totalAssetsDraftId?: string;
            revenueDraftId?: string;
            incidentLogDraftId?: string;
            totalAssetsImageId?: string;
            revenueImageId?: string;
            incidentLogImageId?: string;
            createdAt: string;
            updatedAt: string;
        };
        /** MatchDraftResponse */
        MatchDraftResponse: {
            matchDraftId: string;
            status: string;
            createdAt: string;
            updatedAt: string;
        };
        /** MatchDraftSourceImageListResponse */
        MatchDraftSourceImageListResponse: {
            items?: components["schemas"]["MatchDraftSourceImageResponse"][];
        };
        /** MatchDraftSourceImageResponse */
        MatchDraftSourceImageResponse: {
            kind: string;
            contentType?: string;
            createdAt: string;
            imageUrl: string;
        };
        /** MatchListPaginationResponse */
        MatchListPaginationResponse: {
            /** Format: int32 */
            page: number;
            /** Format: int32 */
            pageSize: number;
            /** Format: int32 */
            totalItems: number;
            /** Format: int32 */
            totalPages: number;
            hasPreviousPage: boolean;
            hasNextPage: boolean;
            previousCursor?: string;
            nextCursor?: string;
            lastCursor?: string;
        };
        /** MatchListResponse */
        MatchListResponse: {
            items?: components["schemas"]["MatchSummaryResponse"][];
            pagination: components["schemas"]["MatchListPaginationResponse"];
        };
        /** MatchListSummaryResponse */
        MatchListSummaryResponse: {
            /** Format: int32 */
            incompleteCount: number;
            /** Format: int32 */
            ocrRunningCount: number;
            /** Format: int32 */
            preConfirmCount: number;
            /** Format: int32 */
            needsReviewCount: number;
        };
        /** MatchNoteResponse */
        MatchNoteResponse: {
            body?: string;
            version: string;
            updatedByDisplayName?: string;
            updatedAt?: string;
        };
        /** MatchRankEntry */
        MatchRankEntry: {
            memberId: string;
            /** Format: int32 */
            rank: number;
            /** Format: int32 */
            playOrder: number;
        };
        /** MatchSummaryResponse */
        MatchSummaryResponse: {
            kind: string;
            id: string;
            matchId?: string;
            matchDraftId?: string;
            status: string;
            heldEventId?: string;
            /** Format: int32 */
            matchNoInEvent?: number;
            gameTitleId?: string;
            seasonMasterId?: string;
            mapMasterId?: string;
            ownerMemberId?: string;
            playedAt?: string;
            createdAt: string;
            updatedAt: string;
            ranks?: components["schemas"]["MatchRankEntry"][];
            hasNote?: boolean;
        };
        /** MemberAliasListResponse */
        MemberAliasListResponse: {
            items?: components["schemas"]["MemberAliasResponse"][];
        };
        /** MemberAliasResponse */
        MemberAliasResponse: {
            id: string;
            memberId: string;
            alias: string;
            createdAt: string;
        };
        /** OcrDraftListResponse */
        OcrDraftListResponse: {
            items?: components["schemas"]["OcrDraftResponse"][];
        };
        /** OcrDraftResponse */
        OcrDraftResponse: {
            draftId: string;
            jobId: string;
            requestedScreenType: string;
            detectedScreenType?: string;
            profileId?: string;
            payloadJson: unknown;
            warningsJson: unknown;
            timingsMsJson: unknown;
            createdAt: string;
            updatedAt: string;
        };
        /** OcrFailureResponse */
        OcrFailureResponse: {
            code: string;
            message: string;
            retryable: boolean;
            userAction?: string;
        };
        /** OcrJobHintsRequest */
        OcrJobHintsRequest: {
            gameTitle?: string;
            layoutFamily?: string;
            knownPlayerAliases?: components["schemas"]["PlayerAliasHintRequest"][];
            computerPlayerAliases?: string[];
        };
        /** OcrJobResponse */
        OcrJobResponse: {
            jobId: string;
            draftId: string;
            imageId: string;
            requestedScreenType: string;
            detectedScreenType?: string;
            status: string;
            /** Format: int32 */
            attemptCount: number;
            failure?: components["schemas"]["OcrFailureResponse"];
            createdAt: string;
            updatedAt: string;
        };
        /** PaginationResponse */
        PaginationResponse: {
            /** Format: int32 */
            page: number;
            /** Format: int32 */
            pageSize: number;
            /** Format: int32 */
            totalItems: number;
            /** Format: int32 */
            totalPages: number;
            hasPreviousPage: boolean;
            hasNextPage: boolean;
        };
        /** PlayerAliasHintRequest */
        PlayerAliasHintRequest: {
            memberId: string;
            aliases?: string[];
        };
        /** PlayerResultRequest */
        PlayerResultRequest: {
            memberId: string;
            /** Format: int32 */
            playOrder: number;
            /** Format: int32 */
            rank: number;
            /** Format: int32 */
            totalAssetsManYen: number;
            /** Format: int32 */
            revenueManYen: number;
            incidents: components["schemas"]["IncidentCountsRequest"];
        };
        /** PlayerResultResponse */
        PlayerResultResponse: {
            memberId: string;
            /** Format: int32 */
            playOrder: number;
            /** Format: int32 */
            rank: number;
            /** Format: int32 */
            totalAssetsManYen: number;
            /** Format: int32 */
            revenueManYen: number;
            incidents: components["schemas"]["IncidentCountsResponse"];
        };
        /** ProblemDetails */
        ProblemDetails: {
            type: string;
            title: string;
            /** Format: int32 */
            status: number;
            detail: string;
            /** @enum {string} */
            code: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "UNSUPPORTED_MEDIA_TYPE" | "PAYLOAD_TOO_LARGE" | "CONFLICT" | "MATCH_NOTE_VERSION_CONFLICT" | "IDEMPOTENCY_IN_PROGRESS" | "IDEMPOTENCY_PAYLOAD_MISMATCH" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE" | "ANALYSIS_ARTIFACT_EXPIRED" | "ANALYSIS_SCOPE_NOT_FOUND" | "ANALYSIS_SCOPE_NOT_IN_ARTIFACT" | "ANALYSIS_READ_BUSY" | "ANALYSIS_STATE_UNAVAILABLE" | "ANALYSIS_NO_ELIGIBLE_TITLES" | "ANALYSIS_CLIENT_UPGRADE_REQUIRED" | "DEPENDENCY_FAILED" | "INTERNAL_ERROR";
        };
        /** ReplaceMatchNoteRequest */
        ReplaceMatchNoteRequest: {
            body?: string;
            expectedVersion: string;
        };
        /** ReplaceMatchNoteResponse */
        ReplaceMatchNoteResponse: {
            matchId: string;
            version: string;
        };
        /** SeasonMasterListResponse */
        SeasonMasterListResponse: {
            items?: components["schemas"]["SeasonMasterResponse"][];
        };
        /** SeasonMasterResponse */
        SeasonMasterResponse: {
            id: string;
            gameTitleId: string;
            name: string;
            /** Format: int32 */
            displayOrder: number;
            createdAt: string;
        };
        /** SeriesAnalysisAcceptedCampaignResponse */
        SeriesAnalysisAcceptedCampaignResponse: {
            campaignId: string;
            status: string;
        };
        /** SeriesAnalysisAcceptedTargetResponse */
        SeriesAnalysisAcceptedTargetResponse: {
            gameTitleId: string;
            jobId?: string;
            requestDisposition: string;
        };
        /** SeriesAnalysisAdminOverviewResponse */
        SeriesAnalysisAdminOverviewResponse: {
            /** Format: int32 */
            schemaVersion: number;
            titleOptions?: components["schemas"]["SeriesAnalysisAdminTitleOptionResponse"][];
            selectedTitle?: components["schemas"]["SeriesAnalysisSelectedTitleResponse"];
            globalExecution: components["schemas"]["SeriesAnalysisGlobalExecutionResponse"];
            recentJobs?: components["schemas"]["SeriesAnalysisJobSummaryResponse"][];
        };
        /** SeriesAnalysisAdminTitleOptionResponse */
        SeriesAnalysisAdminTitleOptionResponse: {
            gameTitleId: string;
            gameTitleName: string;
            /** Format: int64 */
            confirmedMatchCount: number;
        };
        /** SeriesAnalysisAllRecalculationRequest */
        SeriesAnalysisAllRecalculationRequest: {
            confirmation: string;
        };
        /** SeriesAnalysisArtifactRefResponse */
        SeriesAnalysisArtifactRefResponse: {
            artifactId: string;
            gameTitleId: string;
            inputRevision: string;
            algorithmVersion: string;
            /** Format: int32 */
            artifactSchemaVersion: number;
            publishedAt: string;
        };
        /** SeriesAnalysisCalculationResponse */
        SeriesAnalysisCalculationResponse: {
            status: string;
            trigger: string;
            requestedAt: string;
            startedAt?: string;
            finishedAt?: string;
        };
        /** SeriesAnalysisCampaignSummaryResponse */
        SeriesAnalysisCampaignSummaryResponse: {
            campaignId: string;
            /** Format: int32 */
            targetCount: number;
            /** Format: int32 */
            expandedCount: number;
            /** Format: int32 */
            terminalCount: number;
            /** Format: int32 */
            failedCount: number;
            /** Format: int32 */
            skippedCount: number;
            acceptedAt: string;
        };
        /** SeriesAnalysisDesiredResponse */
        SeriesAnalysisDesiredResponse: {
            inputRevision: string;
            algorithmVersion: string;
            /** Format: int32 */
            artifactSchemaVersion: number;
        };
        /** SeriesAnalysisGlobalExecutionResponse */
        SeriesAnalysisGlobalExecutionResponse: {
            /** Format: int32 */
            runningCount: number;
            /** Format: int32 */
            queuedTitleCount: number;
            oldestQueuedAt?: string;
            /** Format: int32 */
            activeCampaignCount: number;
            latestActiveCampaign?: components["schemas"]["SeriesAnalysisCampaignSummaryResponse"];
        };
        /** SeriesAnalysisJobSummaryResponse */
        SeriesAnalysisJobSummaryResponse: {
            jobId: string;
            gameTitleId: string;
            gameTitleName: string;
            status: string;
            trigger: string;
            coalescedTriggers?: string[];
            requestedBy: string;
            /** Format: int32 */
            manualRequestCount: number;
            requestedAt: string;
            startedAt?: string;
            finishedAt?: string;
            /** Format: int64 */
            elapsedMilliseconds?: number;
            inputRevision: string;
            algorithmVersion: string;
            /** Format: int32 */
            attemptCount: number;
            /** Format: int32 */
            transientRetryCount: number;
            /** Format: int32 */
            leaseRecoveryCount: number;
            /** Format: int64 */
            queueWaitMilliseconds?: number;
            resultDisposition: string;
            firstManualRequester?: components["schemas"]["SeriesAnalysisRequesterResponse"];
            safeFailureCode?: string;
        };
        /** SeriesAnalysisMapOptionResponse */
        SeriesAnalysisMapOptionResponse: {
            mapMasterId: string;
            displayName: string;
        };
        /** SeriesAnalysisOptionsResponse */
        SeriesAnalysisOptionsResponse: {
            /** Format: int32 */
            schemaVersion: number;
            defaultGameTitleId?: string;
            titles?: components["schemas"]["SeriesAnalysisTitleOptionResponse"][];
        };
        /** SeriesAnalysisPendingManualRunResponse */
        SeriesAnalysisPendingManualRunResponse: {
            /** Format: int32 */
            requestCount: number;
            oldestRequestedAt: string;
        };
        /** SeriesAnalysisRecalculationAcceptedResponse */
        SeriesAnalysisRecalculationAcceptedResponse: {
            /** Format: int32 */
            schemaVersion: number;
            requestId: string;
            acceptedAt: string;
            /** Format: int32 */
            targetCount: number;
            campaign?: components["schemas"]["SeriesAnalysisAcceptedCampaignResponse"];
            target?: components["schemas"]["SeriesAnalysisAcceptedTargetResponse"];
        };
        /** SeriesAnalysisRecalculationRequest */
        SeriesAnalysisRecalculationRequest: {
            gameTitleId: string;
        };
        /** SeriesAnalysisRequesterResponse */
        SeriesAnalysisRequesterResponse: {
            accountId: string;
            displayName: string;
        };
        /** SeriesAnalysisSeasonMapPairResponse */
        SeriesAnalysisSeasonMapPairResponse: {
            seasonMasterId: string;
            mapMasterId: string;
        };
        /** SeriesAnalysisSeasonOptionResponse */
        SeriesAnalysisSeasonOptionResponse: {
            seasonMasterId: string;
            displayName: string;
        };
        /** SeriesAnalysisSelectedTitleResponse */
        SeriesAnalysisSelectedTitleResponse: {
            gameTitleId: string;
            gameTitleName: string;
            status: components["schemas"]["SeriesAnalysisStatusResponse"];
            pendingManualRun?: components["schemas"]["SeriesAnalysisPendingManualRunResponse"];
        };
        /** SeriesAnalysisStatusResponse */
        SeriesAnalysisStatusResponse: {
            /** Format: int32 */
            schemaVersion: number;
            gameTitleId: string;
            desired: components["schemas"]["SeriesAnalysisDesiredResponse"];
            artifactFreshness: string;
            currentArtifact?: components["schemas"]["SeriesAnalysisArtifactRefResponse"];
            calculation?: components["schemas"]["SeriesAnalysisCalculationResponse"];
        };
        /** SeriesAnalysisTitleOptionResponse */
        SeriesAnalysisTitleOptionResponse: {
            gameTitleId: string;
            displayName: string;
            /** Format: int64 */
            confirmedMatchCount: number;
            seasons?: components["schemas"]["SeriesAnalysisSeasonOptionResponse"][];
            maps?: components["schemas"]["SeriesAnalysisMapOptionResponse"][];
            seasonMapPairs?: components["schemas"]["SeriesAnalysisSeasonMapPairResponse"][];
        };
        /** UpdateGameTitleRequest */
        UpdateGameTitleRequest: {
            name: string;
            layoutFamily: string;
        };
        /** UpdateLoginAccountRequest */
        UpdateLoginAccountRequest: {
            displayName?: string;
            playerMemberId?: string;
            loginEnabled?: boolean;
            isAdmin?: boolean;
        };
        /** UpdateMapMasterRequest */
        UpdateMapMasterRequest: {
            name: string;
        };
        /** UpdateMatchDraftRequest */
        UpdateMatchDraftRequest: {
            heldEventId?: string;
            /** Format: int32 */
            matchNoInEvent?: number;
            gameTitleId?: string;
            layoutFamily?: string;
            seasonMasterId?: string;
            ownerMemberId?: string;
            mapMasterId?: string;
            playedAt?: string;
            status?: string;
        };
        /** UpdateMatchRequest */
        UpdateMatchRequest: {
            heldEventId: string;
            /** Format: int32 */
            matchNoInEvent: number;
            gameTitleId: string;
            seasonMasterId: string;
            ownerMemberId: string;
            mapMasterId: string;
            playedAt: string;
            draftIds: components["schemas"]["ConfirmMatchDraftIds"];
            players?: components["schemas"]["PlayerResultRequest"][];
        };
        /** UpdateMatchResponse */
        UpdateMatchResponse: {
            matchId: string;
            heldEventId: string;
            /** Format: int32 */
            matchNoInEvent: number;
        };
        /** UpdateMemberAliasRequest */
        UpdateMemberAliasRequest: {
            memberId: string;
            alias: string;
        };
        /** UpdateSeasonMasterRequest */
        UpdateSeasonMasterRequest: {
            name: string;
        };
        /** UploadImageResponse */
        UploadImageResponse: {
            imageId: string;
            mediaType: string;
            /** Format: int64 */
            sizeBytes: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealthz: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    getHealthzDetails: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthDetailsResponse"];
                };
            };
        };
    };
    getApiAuthLogin: {
        parameters: {
            query?: {
                silent?: string;
                next?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    Location: string;
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid value */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    getApiAuthCallback: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
                error?: string;
            };
            header?: {
                Cookie?: string[];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    Location: string;
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid value */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    postApiAuthLogout: {
        parameters: {
            query?: never;
            header?: {
                "X-CSRF-Token"?: string;
                Cookie?: string[];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: {
                headers: {
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    getApiAuthMe: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                Cookie?: string[];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthMeResponse"];
                };
            };
            default: {
                headers: {
                    "Set-Cookie"?: string[];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    postApiUploadsImages: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": string;
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadImageResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiOcr-jobs": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateOcrJobRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateOcrJobResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiOcr-jobsJobid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OcrJobResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "deleteApiOcr-jobsJobid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CancelOcrJobResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiOcr-draftsDraftid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OcrDraftResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiOcr-drafts": {
        parameters: {
            query: {
                /** @description 1..20 comma-separated ids. */
                ids: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OcrDraftListResponse"];
                };
            };
            /** @description Invalid value for: query parameter ids */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    getApiExportsMatches: {
        parameters: {
            query: {
                format: string;
                seasonMasterId?: string;
                heldEventId?: string;
                matchId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Content-Disposition": string;
                    "Content-Type": string;
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description Invalid value for: query parameter format */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiHeld-events": {
        parameters: {
            query?: {
                q?: string;
                /** @description 1..100; defaults to 20. */
                limit?: number;
                /** @description 1-based page number; defaults to 1. */
                page?: number;
                /** @description 1..100; overrides limit when present. */
                pageSize?: number;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HeldEventListResponse"];
                };
            };
            /** @description Invalid value for: query parameter limit, Invalid value for: query parameter page, Invalid value for: query parameter pageSize */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiHeld-events": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateHeldEventRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HeldEventResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiHeld-eventsHeldeventid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path: {
                heldEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HeldEventDetailResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "deleteApiHeld-eventsHeldeventid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                heldEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteHeldEventResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiMatch-drafts": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMatchDraftRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchDraftResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiMatch-draftsDraftid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchDraftDetailResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "patchApiMatch-draftsDraftid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMatchDraftRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchDraftResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiMatch-draftsDraftidCancel": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CancelMatchDraftResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiMatch-draftsDraftidSource-images": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchDraftSourceImageListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiMatch-draftsDraftidSource-images.zip": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-Request-Id"?: string;
            };
            path: {
                draftId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Content-Type": string;
                    "Content-Disposition": string;
                    "Cache-Control": string;
                    "X-Content-Type-Options": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/zip": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiMatch-draftsDraftidSource-imagesKind": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-Request-Id"?: string;
            };
            path: {
                draftId: string;
                kind: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Content-Type": string;
                    "Cache-Control": string;
                    "X-Content-Type-Options": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    getApiMatches: {
        parameters: {
            query?: {
                heldEventId?: string;
                gameTitleId?: string;
                seasonMasterId?: string;
                status?: string;
                kind?: string;
                /** @description 1..200; defaults to 100. */
                pageSize?: number;
                /** @description Opaque cursor returned by this endpoint. Omit it to refresh the count snapshot. */
                cursor?: string;
                /** @description status_priority, updated_desc, held_desc, held_asc, or match_no_asc. */
                sort?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchListResponse"];
                };
            };
            /** @description Invalid value for: query parameter pageSize */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    postApiMatches: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmMatchRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmMatchResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    getApiMatchesSummary: {
        parameters: {
            query?: {
                heldEventId?: string;
                gameTitleId?: string;
                seasonMasterId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchListSummaryResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    getApiMatchesMatchid: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path: {
                matchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchDetailResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    putApiMatchesMatchid: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                matchId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMatchRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateMatchResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    deleteApiMatchesMatchid: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                matchId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteMatchResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    putApiMatchesMatchidNote: {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                matchId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplaceMatchNoteRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReplaceMatchNoteResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonOptions": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparison": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonReview": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonDrilldown": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonV2Options": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeriesAnalysisOptionsResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonV2Status": {
        parameters: {
            query: {
                gameTitleId: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeriesAnalysisStatusResponse"];
                };
            };
            /** @description Invalid value for: query parameter gameTitleId */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonV2Aggregate": {
        parameters: {
            query: {
                gameTitleId: string;
                artifactId: string;
                seasonMasterId?: string;
                mapMasterId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid value for: query parameter gameTitleId, Invalid value for: query parameter artifactId */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonV2Review": {
        parameters: {
            query: {
                gameTitleId: string;
                artifactId: string;
                seasonMasterId?: string;
                mapMasterId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid value for: query parameter gameTitleId, Invalid value for: query parameter artifactId */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonV2Drilldown": {
        parameters: {
            query: {
                gameTitleId: string;
                artifactId: string;
                memberId: string;
                metricId: string;
                seasonMasterId?: string;
                mapMasterId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid value for: query parameter gameTitleId, Invalid value for: query parameter artifactId, Invalid value for: query parameter memberId, Invalid value for: query parameter metricId */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAnalyticsSeries-comparisonV2Match-context": {
        parameters: {
            query: {
                gameTitleId: string;
                artifactId: string;
                matchId: string;
                seasonMasterId?: string;
                mapMasterId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description Invalid value for: query parameter gameTitleId, Invalid value for: query parameter artifactId, Invalid value for: query parameter matchId */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAdminSeries-analysisOverview": {
        parameters: {
            query?: {
                gameTitleId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeriesAnalysisAdminOverviewResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiAdminSeries-analysisRecalculations": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SeriesAnalysisRecalculationRequest"];
            };
        };
        responses: {
            202: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeriesAnalysisRecalculationAcceptedResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiAdminSeries-analysisRecalculationsAll": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SeriesAnalysisAllRecalculationRequest"];
            };
        };
        responses: {
            202: {
                headers: {
                    "Cache-Control": string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeriesAnalysisRecalculationAcceptedResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiGame-titles": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GameTitleListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiGame-titles": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateGameTitleRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GameTitleResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "deleteApiGame-titlesId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteMasterResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "patchApiGame-titlesId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateGameTitleRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GameTitleResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiMap-masters": {
        parameters: {
            query?: {
                gameTitleId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapMasterListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiMap-masters": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMapMasterRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapMasterResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "deleteApiMap-mastersId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteMasterResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "patchApiMap-mastersId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMapMasterRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MapMasterResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiSeason-masters": {
        parameters: {
            query?: {
                gameTitleId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonMasterListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiSeason-masters": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSeasonMasterRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonMasterResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "deleteApiSeason-mastersId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteMasterResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "patchApiSeason-mastersId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSeasonMasterRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonMasterResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiIncident-masters": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IncidentMasterListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiMember-aliases": {
        parameters: {
            query?: {
                memberId?: string;
            };
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberAliasListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiMember-aliases": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMemberAliasRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberAliasResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "deleteApiMember-aliasesId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteMasterResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "patchApiMember-aliasesId": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMemberAliasRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MemberAliasResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "getApiAdminLogin-accounts": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginAccountListResponse"];
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "postApiAdminLogin-accounts": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateLoginAccountRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginAccountResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    "patchApiAdminLogin-accountsAccountid": {
        parameters: {
            query?: never;
            header?: {
                "X-Momo-Account-Id"?: string;
                "X-CSRF-Token"?: string;
                "Idempotency-Key"?: string;
            };
            path: {
                accountId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateLoginAccountRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginAccountResponse"];
                };
            };
            /** @description Invalid value for: body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            default: {
                headers: {
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
}
