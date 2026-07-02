from __future__ import annotations

from typing import Protocol

from redis.typing import EncodableT, KeyT

type RedisStreamId = int | bytes | str | memoryview[int]


class RedisPipeline(Protocol):  # pragma: no cover
    """Minimal Redis transaction pipeline used for multi-command queue moves."""

    def xadd(self, name: KeyT, fields: dict[EncodableT, EncodableT], /) -> RedisPipeline:
        raise NotImplementedError

    def xack(
        self,
        name: KeyT,
        groupname: KeyT,
        delivery_tag: RedisStreamId,
        /,
    ) -> RedisPipeline:
        raise NotImplementedError

    def execute(self) -> object:
        raise NotImplementedError


class RedisStreamClient(Protocol):  # pragma: no cover
    """Minimal redis-py surface used by RedisOcrJobConsumer."""

    def xgroup_create(
        self,
        name: KeyT,
        groupname: KeyT,
        stream_id: RedisStreamId,
        /,
        *,
        mkstream: bool,
    ) -> object:
        raise NotImplementedError

    def xreadgroup(
        self,
        groupname: str,
        consumername: str,
        streams: dict[KeyT, RedisStreamId],
        /,
        *,
        count: int,
        block: int,
    ) -> object:
        raise NotImplementedError

    def xpending_range(
        self,
        name: KeyT,
        groupname: KeyT,
        min_id: RedisStreamId,
        max_id: RedisStreamId,
        /,
        *,
        count: int,
    ) -> object:
        raise NotImplementedError

    def xclaim(
        self,
        name: KeyT,
        groupname: KeyT,
        consumername: KeyT,
        /,
        *,
        min_idle_time: int,
        message_ids: list[RedisStreamId] | tuple[RedisStreamId],
    ) -> object:
        raise NotImplementedError

    def xack(self, name: KeyT, groupname: KeyT, delivery_tag: RedisStreamId, /) -> object:
        raise NotImplementedError

    def pipeline(
        self,
        transaction: object | None = None,
        shard_hint: object | None = None,
    ) -> object:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError
