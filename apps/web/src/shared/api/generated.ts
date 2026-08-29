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
        /** SeriesAnalysisAdminOverviewResponse */
        SeriesAnalysisAdminOverviewResponse: {
            /**
             * Format: int32
             * @enum {integer}
             */
            schemaVersion: 1;
            titleOptions: components["schemas"]["SeriesAnalysisAdminTitleOptionResponse"][];
            selectedTitle: {
                gameTitleId: string;
                gameTitleName: string;
                status: components["schemas"]["SeriesAnalysisStatusResponse"];
                pendingManualRun: {
                    /** Format: int32 */
                    requestCount: number;
                    oldestRequestedAt: string;
                } | null;
            } | null;
            globalExecution: components["schemas"]["SeriesAnalysisGlobalExecutionResponse"];
            recentJobs: components["schemas"]["SeriesAnalysisJobSummaryResponse"][];
        };
        /** SeriesAnalysisAdminTitleOptionResponse */
        SeriesAnalysisAdminTitleOptionResponse: {
            gameTitleId: string;
            gameTitleName: string;
            /** Format: int64 */
            confirmedMatchCount: number;
        };
        /** Series Analysis Aggregate Resource v3 */
        SeriesAnalysisAggregateResponse: {
            assetStyleProfiles: {
                blowoutWinThreshold: null | number;
                entries: {
                    evidence: {
                        /** @enum {string} */
                        kind: "high_asset_rate" | "low_asset_rate" | "win_rate";
                        /** @enum {string} */
                        tone: "strength" | "risk" | "neutral";
                        value: null | number;
                    }[];
                    memberId: string;
                    metrics: {
                        averageRevenueAssetRate: null | number;
                        blowoutWinCount: number;
                        destinationAverage: null | number;
                        destinationPositiveRate: null | number;
                        heavyLossCount: number;
                        highAssetCount: number;
                        highAssetRate: null | number;
                        lowAssetCount: number;
                        lowAssetRate: null | number;
                        lowerHalfMedianGap: null | number;
                        lowerHalfRate: null | number;
                        medianAssets: null | number;
                        nearMissSecondCount: number;
                        p10Assets: null | number;
                        p90Assets: null | number;
                        p90P10Spread: null | number;
                        podiumRate: null | number;
                        secondCount: number;
                        secondMedianGap: null | number;
                        secondRate: null | number;
                        winCount: number;
                        winMedianAssets: null | number;
                        winMedianMargin: null | number;
                        winRate: null | number;
                    };
                    primaryKind: null | ("asset_explosion" | "high_risk_breakthrough" | "close_collector" | "steady_accumulator" | "upper_chaser" | "balanced");
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    secondaryKind: null | ("high_variance" | "mobility_collecting" | "upper_chaser" | "property_base" | "downside_risk" | "card_base" | "close_finish");
                    shapeKind: null | ("two_tailed" | "upper_side" | "lower_tail" | "thin_right_tail" | "right_tail" | "middle_heavy");
                    tags: ("high_variance" | "mobility_collecting" | "upper_chaser" | "property_base" | "downside_risk" | "card_base" | "close_finish")[];
                    targetCount: number;
                    displayName: string;
                }[];
                heavyLossThreshold: null | number;
                highAssetThreshold: null | number;
                lowAssetThreshold: null | number;
                nearMissSecondThreshold: null | number;
            };
            cardShopDestination: {
                cardShopMatchCount: number;
                cardShopRate: null | number;
                cardShopWithoutDestinationCount: number;
                cardShopWithoutDestinationRate: null | number;
                denominator: number;
                memberId: string;
                quadrants: {
                    averageAssets: null | number;
                    averageRank: null | number;
                    averageRevenue: null | number;
                    itemId: string;
                    /** @enum {string} */
                    kind: "destination_with_shop" | "destination_without_shop" | "no_destination_with_shop" | "no_destination_without_shop";
                    podiumRate: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rate: null | number;
                    targetCount: number;
                    winRate: null | number;
                }[];
                displayName: string;
            }[];
            dataQuality: {
                items: {
                    denominator: number;
                    hasTies: boolean;
                    memberId: string;
                    metricId: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    targetCount: number;
                    displayName: string;
                }[];
                summary: {
                    noTargetCount: number;
                    okCount: number;
                    referenceCount: number;
                };
            };
            headToHead: {
                entries: ({
                    averageAssetsDiff: null | number;
                    averageRankDiff: null | number;
                    betterRankCount: number;
                    betterRankRate: null | number;
                    itemId: string;
                    matchCount: number;
                    opponentMemberId: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    /** @enum {string} */
                    relativeIntensity: "high" | "medium" | "low" | "none";
                    /** @constant */
                    signal: "self";
                    subjectMemberId: string;
                } | {
                    averageAssetsDiff: null | number;
                    averageRankDiff: null | number;
                    betterRankCount: number;
                    betterRankRate: null | number;
                    itemId: string;
                    matchCount: number;
                    opponentMemberId: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    /** @enum {string} */
                    relativeIntensity: "high" | "medium" | "low" | "none";
                    /** @enum {string} */
                    sampleMaturity: "early" | "mature";
                    /** @enum {string} */
                    signal: "no_target" | "reference" | "neutral" | "slight_advantage" | "strong_advantage" | "slight_disadvantage" | "strong_disadvantage";
                    subjectMemberId: string;
                })[];
            };
            highlights: {
                highlightId: string;
                leaderMemberIds: string[];
                metricId: string;
                /** @enum {string} */
                qualityStatus: "ok" | "reference" | "no_target";
                targetCount: number;
                value: number;
            }[];
            histograms: {
                assets: {
                    bins: {
                        index: number;
                        label: string;
                        lowerInclusive: number;
                        upperExclusive: null | number;
                    }[];
                    series: {
                        counts: number[];
                        memberId: string;
                        displayName: string;
                    }[];
                };
                revenue: {
                    bins: {
                        index: number;
                        label: string;
                        lowerInclusive: number;
                        upperExclusive: null | number;
                    }[];
                    series: {
                        counts: number[];
                        memberId: string;
                        displayName: string;
                    }[];
                };
            };
            matchDigest: {
                flagCounts: {
                    [key: string]: number;
                };
                hiddenCount: number;
                recent: {
                    assetGapFirstToLast: null | number;
                    assetGapFirstToSecond: null | number;
                    flags: ("revenue_top_no_win" | "ginji_storm" | "close_finish" | "asset_blowout")[];
                    heldEventId: string;
                    itemId: string;
                    matchId: string;
                    matchIndex: number;
                    matchNoInEvent: number;
                    playedAt: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    revenueTopMemberIds: string[];
                    totalGinjiCount: number;
                    winnerMemberId: null | string;
                }[];
                shownCount: number;
                totalCount: number;
            };
            matchNoInEvent: {
                entries: {
                    /** @enum {string} */
                    category: "regular" | "additional";
                    matchNoInEvent: number;
                    players: {
                        averageRank: null | number;
                        memberId: string;
                        podiumRate: null | number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        targetCount: number;
                        displayName: string;
                    }[];
                }[];
            };
            metricDefinitions: {
                label: string;
                metricId: string;
                /** @enum {string} */
                preferredDirection: "higher" | "lower" | "contextual";
                /** @enum {string} */
                unit: "rank" | "count" | "man_yen" | "rate";
            }[];
            metricsByPlayer: {
                assets: {
                    average: null | number;
                    max: null | number;
                    median: null | number;
                    min: null | number;
                };
                denominator: number;
                destination: {
                    conversionDelta: null | number;
                    dependenceScore: null | number;
                    lowerTargetCount: number;
                    upperTargetCount: number;
                };
                destinationOutcome: {
                    lowDestination: {
                        lowerHalfCount: number;
                        lowerHalfRate: null | number;
                        podiumCount: number;
                        podiumRate: null | number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        rankDistribution: {
                            count: number;
                            rank: number;
                            rate: null | number;
                        }[];
                        targetCount: number;
                        winCount: number;
                        winRate: null | number;
                    };
                    top: {
                        lowerHalfCount: number;
                        lowerHalfRate: null | number;
                        podiumCount: number;
                        podiumRate: null | number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        rankDistribution: {
                            count: number;
                            rank: number;
                            rate: null | number;
                        }[];
                        targetCount: number;
                        winCount: number;
                        winRate: null | number;
                    };
                    zeroDestination: {
                        lowerHalfCount: number;
                        lowerHalfRate: null | number;
                        podiumCount: number;
                        podiumRate: null | number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        rankDistribution: {
                            count: number;
                            rank: number;
                            rate: null | number;
                        }[];
                        targetCount: number;
                        winCount: number;
                        winRate: null | number;
                    };
                };
                ginji: {
                    count: number;
                    encounterMatches: number;
                    encounterRate: null | number;
                    maxInSingleMatch: number;
                    multiEncounterMatchCount: number;
                    resilienceAssetsAverage: null | number;
                    resilienceRankAverage: null | number;
                    resilienceRevenueAverage: null | number;
                };
                lowerHalf: {
                    count: number;
                    rate: null | number;
                };
                memberId: string;
                nonRevenue: {
                    highRevenueNoWinCount: number;
                    highRevenueNoWinRate: null | number;
                    highRevenueTopCount: number;
                    rankDelta: null | number;
                };
                playOrder: {
                    assetsDiff: null | number;
                    assetsIndex: null | number;
                    breakdown: {
                        assetsAverage: null | number;
                        matchCount: number;
                        playOrder: number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        rankAverage: null | number;
                        revenueAverage: null | number;
                    }[];
                    revenueDiff: null | number;
                    revenueIndex: null | number;
                };
                podium: {
                    count: number;
                    rate: null | number;
                };
                /** @enum {string} */
                qualityStatus: "ok" | "reference" | "no_target";
                rank: {
                    average: null | number;
                    distribution: {
                        count: number;
                        rank: number;
                        rate: null | number;
                    }[];
                    standardDeviation: null | number;
                };
                revenue: {
                    average: null | number;
                    max: null | number;
                    median: null | number;
                };
                revenueOutcome: {
                    lowRevenue: {
                        lowerHalfCount: number;
                        lowerHalfRate: null | number;
                        podiumCount: number;
                        podiumRate: null | number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        rankDistribution: {
                            count: number;
                            rank: number;
                            rate: null | number;
                        }[];
                        targetCount: number;
                        winCount: number;
                        winRate: null | number;
                    };
                    nonTopWinCount: number;
                    top: {
                        lowerHalfCount: number;
                        lowerHalfRate: null | number;
                        podiumCount: number;
                        podiumRate: null | number;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        rankDistribution: {
                            count: number;
                            rank: number;
                            rate: null | number;
                        }[];
                        targetCount: number;
                        winCount: number;
                        winRate: null | number;
                    };
                };
                displayName: string;
            }[];
            momentumSwitch: {
                afterFourth: {
                    baselineRate: null | number;
                    deltaFromBaseline: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rate: null | number;
                    /** @enum {string} */
                    signal: "strength" | "risk" | "none";
                    successCount: number;
                    targetCount: number;
                };
                afterLower: {
                    baselineRate: null | number;
                    deltaFromBaseline: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rate: null | number;
                    /** @enum {string} */
                    signal: "strength" | "risk" | "none";
                    successCount: number;
                    targetCount: number;
                };
                afterPodium: {
                    baselineRate: null | number;
                    deltaFromBaseline: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rate: null | number;
                    /** @enum {string} */
                    signal: "strength" | "risk" | "none";
                    successCount: number;
                    targetCount: number;
                };
                cells: {
                    count: number;
                    itemId: string;
                    nextRank: number;
                    previousRank: number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rate: null | number;
                    /** @enum {string} */
                    relativeIntensity: "high" | "medium" | "low" | "none";
                    targetCount: number;
                }[];
                denominator: number;
                memberId: string;
                transitionCount: number;
                displayName: string;
            }[];
            performanceProfiles: {
                averageRankScoreMedian: null | number;
                averageRevenueAssetRateMedian: null | number;
                entries: {
                    averageRankScore: null | number;
                    averageRevenueAssetRate: null | number;
                    memberId: string;
                    profileKind: null | ("steady_leader" | "swing_leader" | "steady_chaser" | "swing_chaser");
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rankStandardDeviation: null | number;
                    strategyKind: null | ("property_focused" | "card_focused" | "balanced");
                    displayName: string;
                }[];
                rankStandardDeviationMedian: null | number;
            };
            playOrderComparison: {
                bestPlayOrder: null | number;
                cells: {
                    itemId: string;
                    playOrder: number;
                    podiumRate: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rankAverage: null | number;
                    /** @enum {string} */
                    relativeIntensity: "high" | "medium" | "low" | "none";
                    targetCount: number;
                }[];
                memberId: string;
                /** @enum {string} */
                signal: "no_target" | "flat" | "visible" | "large";
                spread: null | number;
                worstPlayOrder: null | number;
                displayName: string;
            }[];
            players: {
                memberId: string;
                displayName: string;
            }[];
            rankAnalysis: {
                crownCertainty: {
                    bootstrapIterations: number;
                    leaderChangeCount: number;
                    shares: {
                        memberId: string;
                        share: number;
                        displayName: string;
                    }[];
                    /** @enum {string} */
                    status: "ok" | "reference" | "no_target";
                    successfulIterations: number;
                };
                defaultMemberId: null | string;
                foldScores: {
                    baselineBrierScore: number;
                    baselineLogLoss: number;
                    comparisonCount: number;
                    fold: number;
                    fullBrierScore: number;
                    fullLogLoss: number;
                    fullModelImproved: boolean;
                    heldEventCount: number;
                }[];
                heldEventCount: number;
                improvedFoldCount: number;
                matchCount: number;
                /** @constant */
                modelVersion: "rank-bt-v1";
                rankSignalsByPlayer: {
                    candidates: {
                        candidateSharePercent: null | number;
                        /** @enum {string} */
                        direction: "more_is_higher" | "less_is_higher";
                        importance: number;
                        /** @enum {string} */
                        signal: "revenue" | "destination" | "plus_station" | "minus_station" | "card_station" | "card_shop" | "ginji";
                        /** @enum {string} */
                        stabilityBand: "high" | "medium" | "low";
                        stable: boolean;
                        supportCount: number;
                    }[];
                    memberId: string;
                    /** @enum {string} */
                    status: "ok" | "reference" | "no_target";
                    displayName: string;
                }[];
                reasonCodes: ("insufficient_matches" | "insufficient_events" | "model_not_better" | "unstable_signals" | "model_not_converged" | "calculation_failed" | "invalid_dataset")[];
                requiredImprovedFoldCount: number;
                /** @enum {string} */
                status: "ok" | "reference" | "no_target";
                unexpectedWinsByPlayer: {
                    hasDetails: boolean;
                    latest: null | {
                        actualRank: number;
                        evidence: {
                            cardShopCount: number;
                            cardStationCount: number;
                            destinationCount: number;
                            ginjiCount: number;
                            minusStationCount: number;
                            plusStationCount: number;
                            revenueManYen: number;
                        };
                        expectedRank: number;
                        heldEventId: string;
                        matchId: string;
                        matchNoInEvent: number;
                        playedAt: string;
                    };
                    memberId: string;
                    /** @enum {string} */
                    status: "ok" | "reference" | "no_target";
                    totalWinCount: number;
                    unexpectedWinCount: number;
                    displayName: string;
                }[];
            };
            rankDistribution: {
                cells: {
                    count: number;
                    itemId: string;
                    rank: number;
                    rate: null | number;
                }[];
                memberId: string;
                /** @enum {string} */
                qualityStatus: "ok" | "reference" | "no_target";
                total: number;
                displayName: string;
            }[];
            recentRanks: {
                averageRank: null | number;
                lowerHalfStreak: number;
                memberId: string;
                podiumRate: null | number;
                podiumStreak: number;
                /** @enum {string} */
                qualityStatus: "ok" | "reference" | "no_target";
                rows: {
                    itemId: string;
                    matchId: string;
                    playedAt: string;
                    rank: number;
                }[];
                targetCount: number;
                usedFallback: boolean;
                winStreak: number;
                windowSize: number;
                displayName: string;
            }[];
            revenueRankConversion: {
                cells: {
                    count: number;
                    finalRank: number;
                    hasRevenueTie: boolean;
                    itemId: string;
                    rate: null | number;
                    /** @enum {string} */
                    relativeIntensity: "high" | "medium" | "low" | "none";
                    revenueRank: number;
                }[];
                memberId: string;
                displayName: string;
            }[];
            /** @constant */
            schemaVersion: 3;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            source: {
                gameTitleId: string;
            };
            strategyScatter: {
                points: {
                    assetRank: null | number;
                    itemId: string;
                    matchId: string;
                    matchIndex: number;
                    memberId: string;
                    playedAt: string;
                    rank: number;
                    revenueAssetRate: null | number;
                    revenueManYen: number;
                    revenueRank: null | number;
                    totalAssetsManYen: number;
                    displayName: string;
                }[];
            };
            summary: {
                averageRankSpread: null | number;
                leaderMemberIds: string[];
                quality: {
                    noTargetCount: number;
                    okCount: number;
                    referenceCount: number;
                };
                /** @enum {string} */
                rankSpreadSignal: "insufficient" | "flat" | "small" | "visible" | "large";
                totalGinjiCount: number;
            };
            trends: {
                /** @enum {string} */
                kind: "rank_cumulative_average" | "rank_cumulative_standard_deviation" | "podium_cumulative_rate" | "lower_half_cumulative_rate" | "ginji_cumulative_count";
                memberId: string;
                points: {
                    index: number;
                    itemId: string;
                    matchId: string;
                    playedAt: string;
                    value: number;
                }[];
                displayName: string;
            }[];
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
        };
        /** SeriesAnalysisAllRecalculationRequest */
        SeriesAnalysisAllRecalculationRequest: {
            confirmation: string;
        };
        /** SeriesAnalysisDesiredResponse */
        SeriesAnalysisDesiredResponse: {
            inputRevision: string;
            algorithmVersion: string;
            /** Format: int32 */
            artifactSchemaVersion: number;
        };
        /** Series Analysis Drilldown Resource v3 */
        SeriesAnalysisDrilldownResponse: {
            payload: {
                eventRows: {
                    /** @enum {string} */
                    changeDirection: "first_observation" | "improved" | "declined" | "unchanged";
                    cumulativeAverageAfter: number;
                    cumulativeAverageBefore: null | number;
                    cumulativeAverageDelta: null | number;
                    eventAverageRank: number;
                    eventAverageRankDelta: null | number;
                    eventRankDelta: null | number;
                    firstPlayedAt: null | string;
                    heldEventId: string;
                    matchCount: number;
                    ranks: number[];
                }[];
                /** @constant */
                kind: "rank_average_history";
                matchRows: {
                    /** @enum {string} */
                    changeDirection: "first_observation" | "improved" | "declined" | "unchanged";
                    cumulativeAverageRank: number;
                    cumulativeAverageRankDelta: null | number;
                    heldEventId: string;
                    itemId: string;
                    matchId: string;
                    matchIndex: number;
                    matchNoInEvent: number;
                    playedAt: string;
                    previousRank: null | number;
                    rank: number;
                    rankDelta: null | number;
                }[];
                summary: {
                    averageRankDeltaFromFirst: null | number;
                    currentAverageRank: null | number;
                    latestHeldEventAverageRankDelta: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    targetCount: number;
                };
            };
            player: {
                memberId: string;
                displayName: string;
            };
            /** @constant */
            schemaVersion: 3;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
        } | {
            payload: {
                /** @constant */
                kind: "play_order_rank_history";
                rows: {
                    baselineDelta: null | number;
                    baselineRankAverage: null | number;
                    lowerHalfCount: number;
                    lowerHalfRate: null | number;
                    playOrder: number;
                    podiumCount: number;
                    podiumRate: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    rankAverage: null | number;
                    rankDistribution: {
                        count: number;
                        rank: number;
                        rate: null | number;
                    }[];
                    targetCount: number;
                }[];
                seriesByPlayOrder: {
                    /** @enum {string} */
                    changeDirection: "first_observation" | "improved" | "declined" | "unchanged";
                    cumulativeAverageRank: number;
                    heldEventId: string;
                    itemId: string;
                    matchId: string;
                    matchIndex: number;
                    matchNoInEvent: number;
                    occurrenceIndex: number;
                    playOrder: number;
                    playedAt: string;
                    previousCumulativeAverageRank: null | number;
                    rank: number;
                }[];
                summary: {
                    bestPlayOrder: null | number;
                    bestPlayOrderAverageRank: null | number;
                    countsByPlayOrder: {
                        matchCount: number;
                        playOrder: number;
                    }[];
                    currentAverageRank: null | number;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    spread: null | number;
                    targetCount: number;
                    worstPlayOrder: null | number;
                    worstPlayOrderAverageRank: null | number;
                };
            };
            player: {
                memberId: string;
                displayName: string;
            };
            /** @constant */
            schemaVersion: 3;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
        } | {
            payload: {
                candidates: {
                    candidateSharePercent: null | number;
                    /** @enum {string} */
                    direction: "more_is_higher" | "less_is_higher";
                    foldRows: {
                        comparisonCount: number;
                        fold: number;
                        heldEventCount: number;
                        importance: number;
                        supported: boolean;
                    }[];
                    importance: number;
                    /** @enum {string} */
                    signal: "revenue" | "destination" | "plus_station" | "minus_station" | "card_station" | "card_shop" | "ginji";
                    /** @enum {string} */
                    stabilityBand: "high" | "medium" | "low";
                    stable: boolean;
                    supportCount: number;
                }[];
                heldEventCount: number;
                improvedFoldCount: number;
                /** @constant */
                kind: "rank_signals";
                matchCount: number;
                method: {
                    fixedSeed: string;
                    foldCount: number;
                    minimumHeldEvents: number;
                    minimumImportance: number;
                    minimumMatches: number;
                    /** @constant */
                    modelVersion: "rank-bt-v1";
                    requiredImprovedFoldCount: number;
                };
                reasonCodes: ("insufficient_matches" | "insufficient_events" | "model_not_better" | "unstable_signals" | "model_not_converged" | "calculation_failed" | "invalid_dataset")[];
                /** @enum {string} */
                status: "ok" | "reference" | "no_target";
            };
            player: {
                memberId: string;
                displayName: string;
            };
            /** @constant */
            schemaVersion: 3;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
        } | {
            payload: {
                /** @constant */
                kind: "unexpected_wins";
                rows: {
                    actualRank: number;
                    evidence: {
                        cardShopCount: number;
                        cardStationCount: number;
                        destinationCount: number;
                        ginjiCount: number;
                        minusStationCount: number;
                        plusStationCount: number;
                        revenueManYen: number;
                    };
                    expectedRank: number;
                    heldEventId: string;
                    matchId: string;
                    matchIndex: number;
                    matchNoInEvent: number;
                    playedAt: string;
                }[];
                summary: {
                    heldEventCount: number;
                    matchCount: number;
                    reasonCodes: ("insufficient_matches" | "insufficient_events" | "model_not_better" | "unstable_signals" | "model_not_converged" | "calculation_failed" | "invalid_dataset")[];
                    /** @enum {string} */
                    status: "ok" | "reference" | "no_target";
                    totalWinCount: number;
                    unexpectedWinCount: number;
                };
            };
            player: {
                memberId: string;
                displayName: string;
            };
            /** @constant */
            schemaVersion: 3;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
        };
        /** SeriesAnalysisGlobalExecutionResponse */
        SeriesAnalysisGlobalExecutionResponse: {
            /** Format: int32 */
            runningCount: number;
            /** Format: int32 */
            queuedTitleCount: number;
            oldestQueuedAt: string | null;
            /** Format: int32 */
            activeCampaignCount: number;
            latestActiveCampaign: {
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
            } | null;
        };
        /** SeriesAnalysisJobSummaryResponse */
        SeriesAnalysisJobSummaryResponse: {
            jobId: string;
            gameTitleId: string;
            gameTitleName: string;
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed" | "timed_out";
            /** @enum {string} */
            trigger: "manual" | "artifact_schema_update" | "algorithm_update" | "initial_backfill" | "match_mutation";
            coalescedTriggers: ("manual" | "artifact_schema_update" | "algorithm_update" | "initial_backfill" | "match_mutation")[];
            /** @enum {string} */
            requestedBy: "administrator" | "mixed" | "system";
            /** Format: int32 */
            manualRequestCount: number;
            requestedAt: string;
            startedAt: string | null;
            finishedAt: string | null;
            /** Format: int64 */
            elapsedMilliseconds: number | null;
            inputRevision: string;
            algorithmVersion: string;
            /** Format: int32 */
            attemptCount: number;
            /** Format: int32 */
            transientRetryCount: number;
            /** Format: int32 */
            leaseRecoveryCount: number;
            /** Format: int64 */
            queueWaitMilliseconds: number | null;
            /** @enum {string} */
            resultDisposition: "none" | "published" | "reused";
            firstManualRequester: {
                accountId: string;
                displayName: string;
            } | null;
            /** @enum {string|null} */
            safeFailureCode: null | "input_contract_invalid" | "input_revision_violation" | "calculation_failed" | "artifact_validation_failed" | "artifact_too_large" | "non_deterministic_output" | "dependency_retry_exhausted" | "lease_recovery_exhausted" | "worker_crashed" | "hard_timeout" | "resource_exhausted" | "temporary_storage_exhausted" | "publication_failed";
        };
        /** SeriesAnalysisMapOptionResponse */
        SeriesAnalysisMapOptionResponse: {
            mapMasterId: string;
            displayName: string;
        };
        SeriesAnalysisMatchContextResponse: {
            match: {
                features: {
                    evidence: {
                        denominator: null | number;
                        metricId: string;
                        /** @enum {string} */
                        qualityStatus: "ok" | "reference" | "no_target";
                        /** @constant */
                        unit: "count";
                        value: null | number;
                    }[];
                    /** @enum {string} */
                    featureCode: "close_finish" | "asset_blowout" | "revenue_top_no_win" | "ginji_storm" | "negative_assets" | "no_destination";
                    memberIds: string[];
                    priority: number;
                    /** @constant */
                    source: "match";
                    /** @enum {string} */
                    tone: "neutral" | "notice";
                }[];
                focusedItemIds: string[];
                matchIndex: number;
                playedAt: null | string;
                players: {
                    cumulativeAverageAfter: number;
                    cumulativeAverageBefore: null | number;
                    cumulativeAverageDelta: null | number;
                    /** @enum {string} */
                    cumulativeAverageDirection: "first_observation" | "improved" | "declined" | "unchanged";
                    memberId: string;
                    previousRank: null | number;
                    rank: number;
                    revenueAssetRate: null | number;
                    revenueManYen: number;
                    revenueRank: null | number;
                    totalAssetsManYen: number;
                    displayName: string;
                }[];
            };
            matchId: string;
            /** @constant */
            schemaVersion: 1;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
            inclusion: {
                sourceMatchRevision: string;
                /** @constant */
                status: "included";
            };
        } | {
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
            inclusion: {
                /** @enum {string} */
                status: "match_changed_since_artifact" | "not_in_artifact" | "not_in_scope";
            };
            match: null;
            matchId: string;
            /** @constant */
            schemaVersion: 1;
            scope: {
                /** @constant */
                kind: "overall";
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                seasonMasterId: string;
                displayName: string;
            };
        };
        /** SeriesAnalysisOptionsResponse */
        SeriesAnalysisOptionsResponse: {
            /**
             * Format: int32
             * @enum {integer}
             */
            schemaVersion: 1;
            defaultGameTitleId: string | null;
            titles: components["schemas"]["SeriesAnalysisTitleOptionResponse"][];
        };
        /** SeriesAnalysisRecalculationAcceptedResponse */
        SeriesAnalysisRecalculationAcceptedResponse: {
            /**
             * Format: int32
             * @enum {integer}
             */
            schemaVersion: 1;
            requestId: string;
            acceptedAt: string;
            /** Format: int32 */
            targetCount: number;
            campaign: {
                campaignId: string;
                /** @enum {string} */
                status: "expanding";
            } | null;
            target: {
                gameTitleId: string;
                jobId: string | null;
                /** @enum {string} */
                requestDisposition: "coalesced_into_queued_job" | "created_job" | "forced_run_reserved";
            } | null;
        };
        /** SeriesAnalysisRecalculationRequest */
        SeriesAnalysisRecalculationRequest: {
            gameTitleId: string;
        };
        /** Series Analysis Review Resource v3 */
        SeriesAnalysisReviewResponse: {
            baseline: {
                matchCount: number;
                playerCount: number;
                /** @enum {string} */
                qualityStatus: "ok" | "reference" | "no_target";
            };
            commonPlaybookTopics: {
                /** @enum {string} */
                category: "revenue" | "destination" | "assets" | "playOrder" | "ginji" | "recovery" | "destinationPositive" | "accident";
                detail: string;
                heading: string;
                playerIds: string[];
                topicId: string;
            }[];
            dataQuality: {
                items: {
                    denominator: number;
                    hasTies: boolean;
                    memberId: string;
                    metricId: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    targetCount: number;
                    displayName: string;
                }[];
                summary: {
                    noTargetCount: number;
                    okCount: number;
                    referenceCount: number;
                };
            };
            playbookByPlayer: {
                player: {
                    memberId: string;
                    displayName: string;
                };
                primaryCard: null | {
                    actionAdviceScore: number;
                    actionHypothesis: string;
                    anchorTarget: {
                        label: string;
                        /** @enum {string} */
                        sectionId: "metric-revenue-outcome" | "metric-destination-outcome" | "metric-money" | "metric-play-order" | "metric-ginji" | "metric-momentum-switch" | "metric-match-digest";
                        /** @enum {string} */
                        view: "drivers" | "context" | "flow";
                    };
                    avoidAction: string;
                    cardId: string;
                    /** @enum {string} */
                    category: "revenue" | "destination" | "assets" | "playOrder" | "ginji" | "recovery" | "destinationPositive" | "accident";
                    /** @enum {string} */
                    classification: "reproduce" | "revise" | "verify";
                    dataReason: string;
                    evidence: [
                        {
                            denominator: number;
                            label: string;
                            metricId: string;
                            /** @enum {string} */
                            qualityStatus: "ok" | "reference" | "no_target";
                            /** @enum {string} */
                            stabilityBand: "high" | "medium" | "low";
                            targetCount: number;
                            /** @enum {string} */
                            unit: "rate" | "score";
                            value: number;
                        },
                        {
                            confidenceHigh: null | number;
                            confidenceLow: null | number;
                            denominator: number;
                            effectEstimate: number;
                            label: string;
                            method: null | "event_cluster_bootstrap_v1";
                            metricId: string;
                            /** @enum {string} */
                            qualityStatus: "ok" | "reference" | "no_target";
                            stability: null | number;
                            /** @enum {string} */
                            stabilityBand: "high" | "medium" | "low";
                            supportCount: number;
                            targetCount: number;
                            /** @enum {string} */
                            unit: "score" | "count";
                            value: number;
                        }
                    ];
                    /** @enum {string} */
                    evidenceStrength: "high" | "medium" | "low";
                    heading: string;
                    plainReason: string;
                    postMatchCheck: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    recommendedAction: string;
                    /** @enum {string} */
                    stabilityBand: "high" | "medium" | "low";
                    supportCount: number;
                    targetCount: number;
                    triggerCondition: string;
                };
                secondaryCards: {
                    actionAdviceScore: number;
                    actionHypothesis: string;
                    anchorTarget: {
                        label: string;
                        /** @enum {string} */
                        sectionId: "metric-revenue-outcome" | "metric-destination-outcome" | "metric-money" | "metric-play-order" | "metric-ginji" | "metric-momentum-switch" | "metric-match-digest";
                        /** @enum {string} */
                        view: "drivers" | "context" | "flow";
                    };
                    avoidAction: string;
                    cardId: string;
                    /** @enum {string} */
                    category: "revenue" | "destination" | "assets" | "playOrder" | "ginji" | "recovery" | "destinationPositive" | "accident";
                    /** @enum {string} */
                    classification: "reproduce" | "revise" | "verify";
                    dataReason: string;
                    evidence: [
                        {
                            denominator: number;
                            label: string;
                            metricId: string;
                            /** @enum {string} */
                            qualityStatus: "ok" | "reference" | "no_target";
                            /** @enum {string} */
                            stabilityBand: "high" | "medium" | "low";
                            targetCount: number;
                            /** @enum {string} */
                            unit: "rate" | "score";
                            value: number;
                        },
                        {
                            confidenceHigh: null | number;
                            confidenceLow: null | number;
                            denominator: number;
                            effectEstimate: number;
                            label: string;
                            method: null | "event_cluster_bootstrap_v1";
                            metricId: string;
                            /** @enum {string} */
                            qualityStatus: "ok" | "reference" | "no_target";
                            stability: null | number;
                            /** @enum {string} */
                            stabilityBand: "high" | "medium" | "low";
                            supportCount: number;
                            targetCount: number;
                            /** @enum {string} */
                            unit: "score" | "count";
                            value: number;
                        }
                    ];
                    /** @enum {string} */
                    evidenceStrength: "high" | "medium" | "low";
                    heading: string;
                    plainReason: string;
                    postMatchCheck: string;
                    /** @enum {string} */
                    qualityStatus: "ok" | "reference" | "no_target";
                    recommendedAction: string;
                    /** @enum {string} */
                    stabilityBand: "high" | "medium" | "low";
                    supportCount: number;
                    targetCount: number;
                    triggerCondition: string;
                }[];
            }[];
            /** @constant */
            schemaVersion: 3;
            scope: {
                /** @constant */
                kind: "overall";
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season";
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            } | {
                /** @constant */
                kind: "map";
                mapMasterId: string;
                matchCount: number;
                displayName: string;
            } | {
                /** @constant */
                kind: "season_map";
                mapMasterId: string;
                matchCount: number;
                seasonMasterId: string;
                displayName: string;
            };
            artifact: {
                algorithmVersion: string;
                artifactId: string;
                artifactSchemaVersion: number;
                gameTitleId: string;
                inputRevision: string;
                publishedAt: string;
            };
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
        /** SeriesAnalysisStatusResponse */
        SeriesAnalysisStatusResponse: {
            /**
             * Format: int32
             * @enum {integer}
             */
            schemaVersion: 1;
            gameTitleId: string;
            desired: components["schemas"]["SeriesAnalysisDesiredResponse"];
            /** @enum {string} */
            artifactFreshness: "current" | "stale" | "unavailable";
            currentArtifact: {
                artifactId: string;
                gameTitleId: string;
                inputRevision: string;
                algorithmVersion: string;
                /** Format: int32 */
                artifactSchemaVersion: number;
                publishedAt: string;
            } | null;
            calculation: {
                /** @enum {string} */
                status: "queued" | "running" | "succeeded" | "failed" | "timed_out";
                /** @enum {string} */
                trigger: "manual" | "artifact_schema_update" | "algorithm_update" | "initial_backfill" | "match_mutation";
                requestedAt: string;
                startedAt: string | null;
                finishedAt: string | null;
            } | null;
        };
        /** SeriesAnalysisTitleOptionResponse */
        SeriesAnalysisTitleOptionResponse: {
            gameTitleId: string;
            displayName: string;
            /** Format: int64 */
            confirmedMatchCount: number;
            seasons: components["schemas"]["SeriesAnalysisSeasonOptionResponse"][];
            maps: components["schemas"]["SeriesAnalysisMapOptionResponse"][];
            seasonMapPairs: components["schemas"]["SeriesAnalysisSeasonMapPairResponse"][];
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
                    "application/json": components["schemas"]["SeriesAnalysisAggregateResponse"];
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
                    "application/json": components["schemas"]["SeriesAnalysisReviewResponse"];
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
                metricId: "rank.averageHistory" | "playOrder.rankHistory" | "rankAnalysis.rankSignals" | "rankAnalysis.unexpectedWins";
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
                    "application/json": components["schemas"]["SeriesAnalysisDrilldownResponse"];
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
                    "application/json": components["schemas"]["SeriesAnalysisMatchContextResponse"];
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
