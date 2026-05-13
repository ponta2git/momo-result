import type { IdempotencyRequestOptions } from "@/shared/api/client";
import {
  createGameTitle,
  createMapMaster,
  createMemberAlias,
  createSeasonMaster,
  deleteGameTitle,
  deleteMapMaster,
  deleteMemberAlias,
  deleteSeasonMaster,
  updateGameTitle,
  updateMapMaster,
  updateMemberAlias,
  updateSeasonMaster,
} from "@/shared/api/masters";
import type {
  CreateGameTitleRequest,
  CreateMapMasterRequest,
  CreateMemberAliasRequest,
  CreateSeasonMasterRequest,
  UpdateGameTitleRequest,
  UpdateMapMasterRequest,
  UpdateMemberAliasRequest,
  UpdateSeasonMasterRequest,
} from "@/shared/api/masters";

export function postGameTitle(request: CreateGameTitleRequest, options: IdempotencyRequestOptions) {
  return createGameTitle(request, options);
}

export function postMapMaster(request: CreateMapMasterRequest, options: IdempotencyRequestOptions) {
  return createMapMaster(request, options);
}

export function postSeasonMaster(
  request: CreateSeasonMasterRequest,
  options: IdempotencyRequestOptions,
) {
  return createSeasonMaster(request, options);
}

export function postMemberAlias(
  request: CreateMemberAliasRequest,
  options: IdempotencyRequestOptions,
) {
  return createMemberAlias(request, options);
}

export function patchGameTitle(id: string, request: UpdateGameTitleRequest) {
  return updateGameTitle(id, request);
}

export function patchMapMaster(id: string, request: UpdateMapMasterRequest) {
  return updateMapMaster(id, request);
}

export function patchSeasonMaster(id: string, request: UpdateSeasonMasterRequest) {
  return updateSeasonMaster(id, request);
}

export function patchMemberAlias(id: string, request: UpdateMemberAliasRequest) {
  return updateMemberAlias(id, request);
}

export function removeGameTitle(id: string) {
  return deleteGameTitle(id);
}

export function removeMapMaster(id: string) {
  return deleteMapMaster(id);
}

export function removeSeasonMaster(id: string) {
  return deleteSeasonMaster(id);
}

export function removeMemberAlias(id: string) {
  return deleteMemberAlias(id);
}
