#!/usr/bin/env python3
"""Offline MOM-30 experiment. Reads an explicit snapshot; never connects to a DB."""

import argparse
import bisect
import collections
import hashlib
import itertools
import json
import math
from pathlib import Path
import statistics


CANONICAL = ['member_eu', 'member_ponta', 'member_akane_mami', 'member_otaka']
METRICS = {
    'rank_mean': ('平均順位', -1, '位'),
    'win_rate': ('勝率', 1, '%'),
    'podium_rate': ('入賞率', 1, '%'),
    'non_last_rate': ('最下位でない割合', 1, '%'),
    'rank_sd': ('順位のばらつき', 0, ''),
    'assets_mean': ('平均総資産', 1, '万円'),
    'assets_median': ('総資産の中央値', 1, '万円'),
    'assets_p10': ('総資産の下位10%点', 1, '万円'),
    'assets_p90': ('総資産の上位10%点', 1, '万円'),
    'assets_max': ('総資産の最高額', 1, '万円'),
    'revenue_mean': ('平均物件収益', 1, '万円'),
    'revenue_median': ('物件収益の中央値', 1, '万円'),
    'revenue_p90': ('物件収益の上位10%点', 1, '万円'),
    'revenue_max': ('物件収益の最高額', 1, '万円'),
    'revenue_rank': ('平均物件収益順位', -1, '位'),
    'destination_mean': ('目的地の平均到着回数', 1, '回/試合'),
    'destination_rate': ('目的地到着試合率', 1, '%'),
    'ginji_avoid': ('銀次の非遭遇試合率', 1, '%'),
    'top_revenue_win': ('収益トップ時の勝率', 1, '%'),
    'low_revenue_podium': ('低収益時の入賞率', 1, '%'),
    'zero_destination_podium': ('目的地なしの入賞率', 1, '%'),
    'ginji_rank': ('銀次遭遇試合の平均順位', -1, '位'),
    'ginji_podium': ('銀次遭遇試合の入賞率', 1, '%'),
    'ginji_assets_median': ('銀次遭遇試合の資産中央値', 1, '万円'),
    'after_lower_podium': ('前戦下位からの入賞率', 1, '%'),
    'non_revenue_delta': ('収益順位と最終順位の差', 0, '位'),
    'destination_delta': ('目的地順位と最終順位の差', 0, '位'),
    'plus_station_mean': ('プラス駅の平均回数', 0, '回/試合'),
    'minus_station_mean': ('マイナス駅の平均回数', 0, '回/試合'),
    'card_station_mean': ('カード駅の平均回数', 0, '回/試合'),
    'card_shop_mean': ('カード売り場の平均回数', 0, '回/試合'),
}
AXIS_SETS = {
    'basic4': ['rank_mean', 'assets_mean', 'revenue_mean', 'destination_mean'],
    'median4': ['rank_mean', 'assets_median', 'revenue_mean', 'destination_mean'],
    'compact3': ['rank_mean', 'revenue_mean', 'destination_mean'],
    'downside5': ['rank_mean', 'assets_median', 'assets_p10', 'revenue_mean', 'destination_mean'],
    'reference9': ['rank_mean', 'revenue_max', 'revenue_mean', 'revenue_median',
                   'ginji_avoid', 'destination_mean', 'assets_median', 'assets_mean', 'assets_max'],
    'quantile9': ['rank_mean', 'revenue_p90', 'revenue_mean', 'revenue_median',
                  'ginji_avoid', 'destination_mean', 'assets_median', 'assets_mean', 'assets_p90'],
    'profile8': ['rank_mean', 'revenue_p90', 'revenue_mean', 'ginji_avoid',
                 'destination_mean', 'assets_p10', 'assets_median', 'assets_p90'],
    'no_destination6': ['rank_mean', 'revenue_p90', 'revenue_mean',
                        'assets_p10', 'assets_median', 'assets_p90'],
    'wins7': ['rank_mean', 'revenue_p90', 'revenue_mean', 'win_rate',
              'assets_p10', 'assets_median', 'assets_p90'],
    'rebound7': ['rank_mean', 'revenue_p90', 'revenue_mean', 'after_lower_podium',
                 'assets_p10', 'assets_median', 'assets_p90'],
    'ginji7': ['rank_mean', 'revenue_p90', 'revenue_mean', 'ginji_rank',
               'assets_p10', 'assets_median', 'assets_p90'],
}
QUANTILE_LEVELS = [.05, .10, .20, .35, .50, .65, .80, .90, .99]
DIAGNOSTIC_AXIS_SET = 'median4'
MIN_CALIBRATION_MATCHES = 40
MIN_CALIBRATION_EVENTS = 8
# These are experimental display policies, not statistical significance thresholds.
MIN_SCORE_MATCHES = 3
MIN_RANK_MATCHES = 40
MIN_RANK_EVENTS = 8


def quantile(values, probability):
    """Linear interpolation at (n-1)*p, including both endpoints."""
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lo = math.floor(position)
    hi = math.ceil(position)
    return ordered[lo] * (hi - position) + ordered[hi] * (position - lo) if hi != lo else ordered[lo]


def mean(values):
    return statistics.fmean(values) if values else None


def value_rank(value, values):
    return sum(v > value for v in values) + (sum(v == value for v in values) + 1) / 2


def rounded_total(value):
    return math.floor(value * 100 + .5 + 1e-10) / 100


def competition_ranks(values):
    if any(value is None for value in values):
        return [None] * len(values)
    return [1 + sum(other > value for other in values) for value in values]


def prepare(source):
    if source['schemaVersion'] != 'mom30-source-v1':
        raise ValueError('Unsupported snapshot schema')
    if source['totalMatchCount'] != len(source['matches']):
        raise ValueError('Snapshot is truncated')
    players = sorted(source['players'], key=lambda p: (CANONICAL.index(p['id']) if p['id'] in CANONICAL else 4, p['id']))
    ids = [p['id'] for p in players]
    if len(ids) != 4 or len(set(ids)) != 4:
        raise ValueError('Exactly four distinct players are required')
    matches = sorted(source['matches'], key=lambda m: (m['playedAt'], m['eventId'], m['eventNo'], m['id']))
    seen = set()
    for match in matches:
        if match['id'] in seen:
            raise ValueError('Duplicate match')
        seen.add(match['id'])
        if sorted(p['id'] for p in match['players']) != sorted(ids):
            raise ValueError('Roster differs between matches')
        if sorted(p['rank'] for p in match['players']) != [1, 2, 3, 4]:
            raise ValueError('Invalid stored ranks')
        if sorted(p['order'] for p in match['players']) != [1, 2, 3, 4]:
            raise ValueError('Invalid play orders')
        match['_players'] = {p['id']: p for p in match['players']}
        for row in match['players']:
            for field in ('assets', 'revenue'):
                if type(row[field]) is not int:
                    raise ValueError('Money must be integer man-yen')
            if any(type(v) is not int or v < 0 for v in row['incidents'].values()):
                raise ValueError('Incident counts must be nonnegative integers')
            row['_destination'] = row['incidents'].get('incident_destination', 0)
            row['_ginji'] = row['incidents'].get('incident_suri_no_ginji', 0)
        for row in match['players']:
            row['_revenue_rank'] = value_rank(row['revenue'], [p['revenue'] for p in match['players']])
            row['_destination_rank'] = value_rank(row['_destination'], [p['_destination'] for p in match['players']])
            row['_top_revenue'] = row['revenue'] == max(p['revenue'] for p in match['players'])
    return players, matches


def player_metrics(matches, player_id):
    rows = [m['_players'][player_id] for m in matches]
    n = len(rows)
    if not n:
        return {key: {'value': None, 'n': 0} for key in METRICS}
    rank = [p['rank'] for p in rows]
    assets = [p['assets'] for p in rows]
    revenue = [p['revenue'] for p in rows]
    revenue_rank = [p['_revenue_rank'] for p in rows]
    destination_rank = [p['_destination_rank'] for p in rows]
    top = [p for p in rows if p['_top_revenue']]
    low = [p for p in rows if p['_revenue_rank'] > 2.5]
    zero = [p for p in rows if p['_destination'] == 0]
    ginji = [p for p in rows if p['_ginji'] > 0]
    # Adjacent matches in the selected scope, matching the existing analysis contract.
    after_lower = [current for previous, current in zip(rows, rows[1:]) if previous['rank'] >= 3]
    result = {
        'rank_mean': mean(rank), 'win_rate': mean([r == 1 for r in rank]),
        'podium_rate': mean([r <= 2 for r in rank]), 'non_last_rate': mean([r != 4 for r in rank]),
        'rank_sd': statistics.pstdev(rank),
        'assets_mean': mean(assets), 'assets_median': statistics.median(assets),
        'assets_p10': quantile(assets, .1), 'assets_p90': quantile(assets, .9), 'assets_max': max(assets),
        'revenue_mean': mean(revenue), 'revenue_median': statistics.median(revenue), 'revenue_max': max(revenue),
        'revenue_rank': mean(revenue_rank), 'revenue_p90': quantile(revenue, .9),
        'destination_mean': mean([p['_destination'] for p in rows]),
        'destination_rate': mean([p['_destination'] > 0 for p in rows]),
        'ginji_avoid': mean([p['_ginji'] == 0 for p in rows]),
        'non_revenue_delta': mean([a - b for a, b in zip(revenue_rank, rank)]),
        'destination_delta': mean([a - b for a, b in zip(destination_rank, rank)]),
    }
    answer = {key: {'value': value, 'n': n} for key, value in result.items()}
    for field in ('plus_station', 'minus_station', 'card_station', 'card_shop'):
        answer[field + '_mean'] = {'value': mean([p['incidents'].get('incident_' + field, 0) for p in rows]), 'n': n}
    for key, subset, field in [('top_revenue_win', top, 'win'), ('low_revenue_podium', low, 'podium'),
                               ('zero_destination_podium', zero, 'podium'), ('ginji_rank', ginji, 'rank'),
                               ('ginji_podium', ginji, 'podium'),
                               ('after_lower_podium', after_lower, 'podium')]:
        values = [p['rank'] if field == 'rank' else (p['rank'] == 1 if field == 'win' else p['rank'] <= 2) for p in subset]
        answer[key] = {'value': mean(values), 'n': len(subset)}
    answer['ginji_assets_median'] = {'value': statistics.median([p['assets'] for p in ginji]) if ginji else None,
                                    'n': len(ginji)}
    return answer


def reference_windows(matches, ids, window, stride=1):
    distributions = {key: [] for key, (_, direction, _) in METRICS.items() if direction}
    for start in range(0, len(matches) - window + 1, stride):
        subset = matches[start:start + window]
        for player_id in ids:
            values = player_metrics(subset, player_id)
            for key in distributions:
                # Sparse conditional samples may be listed but cannot create a scoring distribution.
                if values[key]['value'] is not None and values[key]['n'] >= min(10, window):
                    distributions[key].append(values[key]['value'] * METRICS[key][1])
    return distributions


def threshold_definition(values, method, direction, upper_bound=None):
    if len(values) < 8:
        return {'status': 'insufficient_reference', 'thresholds': None}
    q10, q50, q90 = [quantile(values, p) for p in (.1, .5, .9)]
    if not q10 < q50 < q90:
        return {'status': 'degenerate_reference', 'thresholds': None}
    if method == 'quantile':
        boundaries = [quantile(values, p) for p in QUANTILE_LEVELS]
    elif method == 'spread':
        # The median is the lower boundary of 6. Top score requires 1.6 upper spreads.
        upper_spread = q90 - q50
        if upper_bound is not None:
            upper_spread = min(upper_spread, (upper_bound - q50) / 1.6)
        boundaries = [q50 + (point - 6) / 2.5 * (q50 - q10 if point < 6 else upper_spread)
                      for point in range(2, 11)]
        if upper_bound is not None:
            boundaries[-1] = min(boundaries[-1], upper_bound)
    else:
        raise ValueError('Unknown threshold method')
    return {'status': 'ready', 'thresholds': boundaries,
            'rawThresholds': [v * direction for v in boundaries],
            'reference': {'q10': q10 * direction, 'median': q50 * direction, 'q90': q90 * direction},
            'referenceValueCount': len(values), 'orientedUpperBound': upper_bound}


def calibrate(matches, ids, window=20, method='spread', stride=1):
    events = len({m['eventId'] for m in matches})
    status = 'ready' if len(matches) >= max(MIN_CALIBRATION_MATCHES, 2 * window) and events >= MIN_CALIBRATION_EVENTS else 'insufficient_calibration'
    distributions = reference_windows(matches, ids, window, stride) if status == 'ready' else {}
    axes = {key: threshold_definition(distributions.get(key, []), method, direction,
                1 if unit == '%' else -1 if direction == -1 and unit == '位' else None)
            if status == 'ready' else {'status': status, 'thresholds': None}
            for key, (_, direction, unit) in METRICS.items() if direction}
    identity = hashlib.sha256(json.dumps({'matches': [(m['id'], m['revision']) for m in matches],
                                         'window': window, 'method': method, 'stride': stride, 'axes': axes}, sort_keys=True).encode()).hexdigest()[:16]
    return {'id': identity, 'status': status, 'n': len(matches), 'events': events,
            'from': matches[0]['playedAt'] if matches else None, 'to': matches[-1]['playedAt'] if matches else None,
            'window': window, 'stride': stride, 'method': method, 'axes': axes}


def score(value, definition, direction):
    if value is None or definition['thresholds'] is None:
        return None
    # Equality belongs to the higher score; no display rounding occurs here.
    return 1 + bisect.bisect_right(definition['thresholds'], value * direction)


def evaluate(matches, ids, baseline, rank_min=MIN_RANK_MATCHES, event_min=MIN_RANK_EVENTS):
    n = len(matches)
    events = len({m['eventId'] for m in matches})
    values = {pid: player_metrics(matches, pid) for pid in ids}
    scored = {}
    for pid in ids:
        scored[pid] = {}
        for key, (_, direction, _) in METRICS.items():
            if not direction:
                continue
            item = values[pid][key]
            value = item['value']
            point = score(value, baseline['axes'][key], direction) if item['n'] >= MIN_SCORE_MATCHES else None
            status = ('no_target' if not item['n'] else 'insufficient_sample') if point is None else 'ready'
            if point is None and item['n'] >= MIN_SCORE_MATCHES:
                status = baseline['axes'][key]['status']
            if point is not None and (item['n'] < rank_min or events < event_min):
                status = 'reference'
            if point is not None and key in ('assets_max', 'revenue_max') and n != baseline.get('window', n):
                status = 'reference_opportunity'
            scored[pid][key] = {**item, 'score': point, 'status': status}
    totals = {}
    for name, axes in AXIS_SETS.items():
        total_values = [rounded_total(mean([scored[pid][key]['score'] for key in axes]))
                        if all(scored[pid][key]['score'] is not None for key in axes) else None for pid in ids]
        ready = all(scored[pid][key]['status'] == 'ready' for pid in ids for key in axes)
        ranks = competition_ranks(total_values) if ready else [None] * len(ids)
        totals[name] = {pid: {'score': total, 'rank': rank, 'status': 'ready' if ready else 'reference' if total is not None else 'unavailable'}
                        for pid, total, rank in zip(ids, total_values, ranks)}
    return {'n': n, 'events': events, 'raw': values, 'scores': scored, 'totals': totals}


def combine_baseline(common, per_map, mode):
    if mode == 'common' or per_map is None:
        return common
    if mode == 'separate':
        return per_map
    # Hybrid compares rank to the title baseline, economic/arrival outcomes to the map baseline.
    combined = dict(per_map)
    combined['axes'] = dict(per_map['axes'])
    for key in ('rank_mean', 'win_rate', 'podium_rate', 'non_last_rate'):
        combined['axes'][key] = common['axes'][key]
    combined['id'] = common['id'] + '+' + per_map['id']
    return combined


def pearson(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    xs, ys = zip(*pairs)
    if len(xs) < 3 or statistics.pstdev(xs) == 0 or statistics.pstdev(ys) == 0:
        return None
    return statistics.correlation(xs, ys)


def score_change(reference, other, ids, axes):
    diffs = [abs(reference['scores'][pid][key]['score'] - other['scores'][pid][key]['score'])
             for pid in ids for key in axes
             if reference['scores'][pid][key]['score'] is not None and other['scores'][pid][key]['score'] is not None]
    return {'compared': len(diffs), 'meanAbsoluteChange': mean(diffs), 'maxChange': max(diffs, default=None)}


def perturbation(matches, ids, baseline, axis_set=DIAGNOSTIC_AXIS_SET):
    axes = AXIS_SETS[axis_set]
    original = evaluate(matches, ids, baseline)
    changes = []
    leaders = collections.Counter()
    original_values = [original['totals'][axis_set][pid]['score'] for pid in ids]
    original_ranks = competition_ranks(original_values)
    rank_changes = 0
    for event in sorted({m['eventId'] for m in matches}):
        sample = [m for m in matches if m['eventId'] != event]
        result = evaluate(sample, ids, baseline)
        changes.append(score_change(original, result, ids, axes))
        ranks = competition_ranks([result['totals'][axis_set][pid]['score'] for pid in ids])
        rank_changes += ranks != original_ranks
        for pid, rank in zip(ids, ranks):
            if rank == 1:
                leaders[pid] += 1
    return {'removedEventTrials': len(changes), 'maxPointChange': max((v['maxChange'] or 0 for v in changes), default=None),
            'meanPointChange': mean([v['meanAbsoluteChange'] for v in changes if v['meanAbsoluteChange'] is not None]),
            'rankingChangedTrials': rank_changes, 'leadingCountsIncludingTies': dict(leaders)}


def review_status(high_players_per_window, events):
    """Proposed advisory, not an instruction to replace a baseline."""
    if len(high_players_per_window) < 2 or events < MIN_CALIBRATION_EVENTS:
        return {'status': 'insufficient_new_records', 'axes': []}
    previous, latest = high_players_per_window[-2:]
    axes = [axis for axis in latest if latest[axis] >= 3 and previous.get(axis, 0) >= 3]
    return {'status': 'review_suggested' if axes else 'no_review_signal', 'axes': axes}


def ginji_evidence(matches, player_id):
    hit_matches = [m for m in matches if m['_players'][player_id]['_ginji'] > 0]
    rows = [m['_players'][player_id] for m in hit_matches]
    counts = {str(rank): sum(p['rank'] == rank for p in rows) for rank in range(1, 5)}
    return {'n': len(rows), 'events': len({m['eventId'] for m in hit_matches}),
            'rankCounts': counts, 'encounters': sum(p['_ginji'] for p in rows),
            'nonEncounterRank': mean([m['_players'][player_id]['rank'] for m in matches if not m['_players'][player_id]['_ginji']]),
            'matches': [{'date': m['playedAt'], 'eventId': m['eventId'], 'eventNo': m['eventNo'],
                         'mapId': m['mapId'], 'rank': m['_players'][player_id]['rank'],
                         'assets': m['_players'][player_id]['assets'], 'ginjiCount': m['_players'][player_id]['_ginji']}
                        for m in hit_matches]}


def conditional_window_trial(calibration, holdout, ids, window, method='spread'):
    """Diagnostic only: aggregate equal numbers of encounters, never impute recovery."""
    keys = ('ginji_rank', 'ginji_podium', 'ginji_assets_median')
    distributions = {key: [] for key in keys}
    count_by_player = {}
    for pid in ids:
        hits = [m for m in calibration if m['_players'][pid]['_ginji'] > 0]
        count_by_player[pid] = len(hits)
        for start in range(0, len(hits) - window + 1):
            metrics = player_metrics(hits[start:start + window], pid)
            for key in keys:
                distributions[key].append(metrics[key]['value'] * METRICS[key][1])
    definitions = {key: threshold_definition(values, method, METRICS[key][1],
                    1 if METRICS[key][2] == '%' else -1 if METRICS[key][1] == -1 else None)
                   for key, values in distributions.items()}
    results = {}
    for pid in ids:
        metrics = player_metrics(holdout, pid)
        results[pid] = {key: {**metrics[key], 'score': score(metrics[key]['value'], definitions[key], METRICS[key][1])
            if metrics[key]['n'] >= MIN_SCORE_MATCHES else None} for key in keys}
    return {'encounterWindow': window, 'calibrationEncounters': count_by_player,
            'referenceValues': {key: len(values) for key, values in distributions.items()},
            'definitions': definitions, 'holdout': results,
            'status': 'diagnostic_only_not_applied'}


def analyze(source):
    players, matches = prepare(source)
    ids = [p['id'] for p in players]
    report = {'schemaVersion': 'mom30-report-v1', 'snapshotAt': source['snapshotAt'], 'players': players,
              'provenance': source.get('provenance'), 'totalMatchCount': len(matches),
              'metrics': {key: {'label': label, 'direction': direction, 'unit': unit} for key, (label, direction, unit) in METRICS.items()},
              'axisSets': AXIS_SETS, 'diagnosticAxisSet': DIAGNOSTIC_AXIS_SET,
              'policy': {'minimumScoreMatches': MIN_SCORE_MATCHES,
              'minimumRankMatches': MIN_RANK_MATCHES, 'minimumRankEvents': MIN_RANK_EVENTS,
              'minimumCalibrationMatches': MIN_CALIBRATION_MATCHES, 'minimumCalibrationEvents': MIN_CALIBRATION_EVENTS,
              'status': 'experimental_not_agreed'}, 'titles': []}
    for title in source['titles']:
        title_matches = [m for m in matches if m['titleId'] == title['id']]
        season_ids = list(dict.fromkeys(m['seasonId'] for m in title_matches))
        map_ids = list(dict.fromkeys(m['mapId'] for m in title_matches))
        calibration = [m for m in title_matches if m['seasonId'] == season_ids[0]]
        holdout = [m for m in title_matches if m['seasonId'] != season_ids[0]]
        if holdout and (calibration[-1]['playedAt'] >= holdout[0]['playedAt'] or {m['eventId'] for m in calibration} & {m['eventId'] for m in holdout}):
            raise ValueError('Earliest-season split is not a chronological event-disjoint holdout')
        baselines = {}
        ginji_baselines = {}
        for period, sample in [('initial', calibration), ('updated', title_matches), ('candidate', title_matches[:-1])]:
            for method in ('spread', 'quantile'):
                for mid in [None] + map_ids:
                    selected = [m for m in sample if mid is None or m['mapId'] == mid]
                    key = '|'.join([period, method, mid or 'all'])
                    baselines[key] = calibrate(selected, ids, method=method)
                trial = conditional_window_trial(sample, [], ids, 5, method)
                common = baselines[period + '|' + method + '|all']
                ginji_baselines[period + '|' + method] = {
                    **common, 'id': common['id'] + '-ginji5',
                    'axes': {**common['axes'], **trial['definitions']},
                    'conditionalWindow': 5, 'conditionalCounts': trial['calibrationEncounters'],
                    'statusNote': 'conditional_axis_is_experimental'}
        scopes = []
        for sid, mid in itertools.product([None] + season_ids, [None] + map_ids):
            selected = [m for m in title_matches if (sid is None or m['seasonId'] == sid) and (mid is None or m['mapId'] == mid)]
            if not selected:
                continue
            evaluations = {}
            for period, method, mode in itertools.product(('initial', 'updated', 'candidate'), ('spread', 'quantile'), ('common', 'separate', 'hybrid')):
                common = baselines['|'.join([period, method, 'all'])]
                per_map = baselines['|'.join([period, method, mid])] if mid else None
                baseline = combine_baseline(common, per_map, mode)
                evaluations['|'.join([period, method, mode])] = evaluate(selected, ids, baseline)
            scopes.append({'id': (sid or 'all') + '|' + (mid or 'all'), 'seasonId': sid, 'mapId': mid,
                           'from': selected[0]['playedAt'], 'to': selected[-1]['playedAt'],
                           'ginjiEvidence': {pid: ginji_evidence(selected, pid) for pid in ids},
                           'ginjiEvaluations': {key: evaluate(selected, ids, value) for key, value in ginji_baselines.items()},
                           'n': len(selected), 'events': len({m['eventId'] for m in selected}), 'evaluations': evaluations})
        common = baselines['initial|spread|all']
        holdout_eval = evaluate(holdout, ids, common)
        axes = AXIS_SETS[DIAGNOSTIC_AXIS_SET]
        variants = []
        for window, stride in [(10, 1), (20, 20), (30, 1)]:
            candidate = calibrate(calibration, ids, window=window, stride=stride)
            result = evaluate(holdout, ids, candidate)
            variants.append({'window': window, 'stride': stride, 'baselineStatus': candidate['status'],
                             'change': score_change(holdout_eval, result, ids, axes),
                             'totals': result['totals'][DIAGNOSTIC_AXIS_SET]})
        # Calibration fragility: leave a whole event out, never holdout data into calibration.
        calibration_changes = []
        for event in sorted({m['eventId'] for m in calibration}):
            candidate = calibrate([m for m in calibration if m['eventId'] != event], ids)
            result = evaluate(holdout, ids, candidate)
            calibration_changes.append(score_change(holdout_eval, result, ids, axes))
        map_checks = []
        for mid in map_ids:
            map_calibration = [m for m in calibration if m['mapId'] == mid]
            map_holdout = [m for m in holdout if m['mapId'] == mid]
            mapped = baselines['initial|spread|' + mid]
            baseline = combine_baseline(common, mapped, 'hybrid')
            original = evaluate(map_holdout, ids, baseline)
            changes = []
            if mapped['status'] == 'ready':
                for event in sorted({m['eventId'] for m in map_calibration}):
                    remaining = [m for m in calibration if m['eventId'] != event]
                    candidate = combine_baseline(calibrate(remaining, ids),
                        calibrate([m for m in remaining if m['mapId'] == mid], ids), 'hybrid')
                    changes.append(score_change(original, evaluate(map_holdout, ids, candidate), ids, axes))
            map_checks.append({'mapId': mid, 'status': mapped['status'], 'calibrationMatches': len(map_calibration),
                'calibrationEvents': len({m['eventId'] for m in map_calibration}), 'holdoutMatches': len(map_holdout),
                'removedCalibrationEventTrials': len(changes),
                'maxPointChange': max((v['maxChange'] for v in changes if v['maxChange'] is not None), default=None),
                'meanPointChange': mean([v['meanAbsoluteChange'] for v in changes if v['meanAbsoluteChange'] is not None])})
        # Correlations are descriptive; disjoint windows avoid overstating sample size.
        blocks = [title_matches[i:i + 20] for i in range(0, len(title_matches) - 19, 20)]
        observations = [player_metrics(block, pid) for block in blocks for pid in ids]
        correlation = []
        for a, b in itertools.combinations(['rank_mean', 'win_rate', 'after_lower_podium', 'assets_mean', 'assets_median', 'assets_p10', 'assets_p90', 'revenue_mean', 'revenue_median', 'revenue_p90', 'destination_mean', 'ginji_avoid'], 2):
            correlation.append({'a': a, 'b': b,
                'observations': sum(v[a]['value'] is not None and v[b]['value'] is not None for v in observations),
                'r': pearson([v[a]['value'] for v in observations], [v[b]['value'] for v in observations])})
        weight_trials = []
        if all(holdout_eval['scores'][pid][key]['score'] is not None for pid in ids for key in axes):
            for axis, factor in itertools.product(axes, (.5, 1.5)):
                totals = [rounded_total(sum(holdout_eval['scores'][pid][key]['score'] * (factor if key == axis else 1) for key in axes) / (len(axes) - 1 + factor)) for pid in ids]
                weight_trials.append({'axis': axis, 'factor': factor, 'totals': dict(zip(ids, totals)), 'ranks': competition_ranks(totals)})
        for scope in scopes:
            selected = [m for m in title_matches if (scope['seasonId'] is None or m['seasonId'] == scope['seasonId']) and (scope['mapId'] is None or m['mapId'] == scope['mapId'])]
            scope['fixedBaselineEventRemoval'] = perturbation(selected, ids, common)
        # A real last-record addition, staged only inside the offline prototype.
        # The candidate uses the snapshot before this record and stays frozen after addition.
        candidate = baselines['candidate|spread|all']
        admin_demo = {'candidate': candidate, 'beforeCount': len(holdout[:-1]), 'afterCount': len(holdout),
            'currentBefore': evaluate(holdout[:-1], ids, common), 'candidateBefore': evaluate(holdout[:-1], ids, candidate),
            'currentAfter': evaluate(holdout, ids, common), 'candidateAfter': evaluate(holdout, ids, candidate)} if holdout else None
        sample_size_checks = []
        for n in (10, 20, 30, 40, 50, 100):
            if len(holdout) >= n:
                subset = holdout[-n:]
                sample_size_checks.append({'n': n, 'events': len({m['eventId'] for m in subset}),
                    **perturbation(subset, ids, common)})
        histogram = {key: {str(point): 0 for point in range(1, 11)} for key in axes}
        high_blocks = []
        for start in range(0, len(holdout) - 19, 20):
            result = evaluate(holdout[start:start + 20], ids, common)
            high = {}
            for key in axes:
                points = [result['scores'][pid][key]['score'] for pid in ids]
                high[key] = sum(point is not None and point >= 9 for point in points)
                for point in points:
                    if point is not None:
                        histogram[key][str(point)] += 1
            high_blocks.append(high)
        complete_count = len(high_blocks) * 20
        review_matches = holdout[max(0, complete_count - 40):complete_count]
        review_events = len({m['eventId'] for m in review_matches})
        review = {**review_status(high_blocks, review_events), 'matches': len(review_matches),
            'events': review_events, 'completedWindows': len(high_blocks),
            'from': review_matches[0]['playedAt'] if review_matches else None,
            'to': review_matches[-1]['playedAt'] if review_matches else None,
            'evidenceId': hashlib.sha256(json.dumps({'baseline': common['id'],
                'matches': [(m['id'], m['revision']) for m in review_matches]}, sort_keys=True).encode()).hexdigest()[:16]}
        report['titles'].append({**title, 'maps': [m for m in source['maps'] if m['id'] in map_ids],
            'seasons': [s for s in source['seasons'] if s['id'] in season_ids],
            'calibrationSeasonId': season_ids[0], 'calibrationMatches': len(calibration), 'holdoutMatches': len(holdout),
            'calibrationEvents': len({m['eventId'] for m in calibration}), 'holdoutEvents': len({m['eventId'] for m in holdout}),
            'baselines': baselines, 'ginjiBaselines': ginji_baselines,
            'scopes': scopes, 'correlations': correlation, 'correlationObservations': len(observations),
            'windowSensitivity': variants, 'weightSensitivity': weight_trials, 'mapCalibrationChecks': map_checks, 'adminDemo': admin_demo,
            'profileDiagnostics': {name: perturbation(holdout, ids, common, name)
                for name in ('quantile9', 'profile8', 'no_destination6', 'wins7', 'rebound7')},
            'ginjiWindowTrials': [conditional_window_trial(calibration, holdout, ids, window) for window in (3, 5, 8)],
            'sampleSizeChecks': sample_size_checks,
            'reviewIndicator': review,
            'saturation': {'windowMatches': 20, 'disjointWindows': len(high_blocks),
                'histogram': histogram, 'highPlayersPerWindow': high_blocks},
            'calibrationEventRemoval': {'trials': len(calibration_changes),
                'maxPointChange': max((v['maxChange'] or 0 for v in calibration_changes), default=None),
                'meanPointChange': mean([v['meanAbsoluteChange'] for v in calibration_changes if v['meanAbsoluteChange'] is not None])}})
    all_scopes = [scope for title in report['titles'] for scope in title['scopes']]
    report['candidateCoverage'] = {
        key: {'qualifiedScopes': sum(scope['events'] >= MIN_RANK_EVENTS and
             all(scope['evaluations']['initial|spread|common']['raw'][pid][key]['n'] >= MIN_RANK_MATCHES for pid in ids)
             for scope in all_scopes), 'totalScopes': len(all_scopes)} for key in METRICS}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('Output must not overwrite input')
    source_bytes = args.input.read_bytes()
    source = json.loads(source_bytes)
    report = analyze(source)
    report['inputSha256'] = hashlib.sha256(source_bytes).hexdigest()
    report['sourceFile'] = args.input.name
    report['analyzerSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'titles': len(report['titles']), 'matches': source['totalMatchCount'], 'output': str(args.output)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
