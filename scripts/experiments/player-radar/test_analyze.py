"""Hand-checkable counterexamples for the offline experiment's decisions."""

import copy
import unittest

import analyze as a


def fixture():
    ids = ['A', 'B', 'C', 'D']
    # All revenues tied: everybody is top, nobody is lower than mean tie-rank 2.5.
    matches = []
    for i in range(4):
        matches.append({'id': str(i), 'playedAt': '2026-01-01T00:00:00.000000Z',
                        'eventId': 'event', 'eventNo': i + 1, 'revision': 1,
                        'titleId': 'title', 'seasonId': 'winter', 'mapId': 'map',
                        'players': [{'id': p, 'order': j + 1, 'rank': j + 1,
                                     'assets': -10 if j == 3 else (j + 1) * 10,
                                     'revenue': 0, 'incidents': {}} for j, p in enumerate(ids)]})
    return {'schemaVersion': 'mom30-source-v1', 'totalMatchCount': 4,
            'players': [{'id': p, 'name': p} for p in ids], 'matches': matches}


class Counterexamples(unittest.TestCase):
    def test_ginji_multi_encounter_denominator_and_no_target(self):
        source = fixture()
        first, second = source['matches'][:2]
        first['players'][0]['incidents']['incident_suri_no_ginji'] = 3
        second['players'][0]['incidents']['incident_suri_no_ginji'] = 1
        second['players'][0]['rank'], second['players'][2]['rank'] = 3, 1
        second['players'][0]['assets'] = -30
        players, matches = a.prepare(source)
        values = a.player_metrics(matches, 'A')
        self.assertEqual(values['ginji_rank'], {'value': 2, 'n': 2})
        self.assertEqual(values['ginji_podium'], {'value': .5, 'n': 2})
        self.assertEqual(values['ginji_assets_median'], {'value': -10, 'n': 2})
        self.assertEqual(a.player_metrics(matches, 'B')['ginji_podium'], {'value': None, 'n': 0})
        evidence = a.ginji_evidence(matches, 'A')
        self.assertEqual((evidence['n'], evidence['encounters']), (2, 4))
        self.assertEqual(evidence['rankCounts'], {'1': 1, '2': 0, '3': 1, '4': 0})
        trial = a.conditional_window_trial(matches, matches, [p['id'] for p in players], 3)
        self.assertEqual(trial['referenceValues']['ginji_rank'], 0)
        self.assertIsNone(trial['holdout']['A']['ginji_rank']['score'])

    def test_stored_rank_ties_and_structural_no_opportunity(self):
        players, matches = a.prepare(fixture())
        winner = a.player_metrics(matches, players[0]['id'])
        loser = a.player_metrics(matches, players[-1]['id'])
        self.assertEqual(winner['rank_mean'], {'value': 1, 'n': 4})
        self.assertEqual(winner['top_revenue_win'], {'value': 1, 'n': 4})
        self.assertEqual(winner['low_revenue_podium'], {'value': None, 'n': 0})
        self.assertEqual(winner['after_lower_podium'], {'value': None, 'n': 0})
        self.assertEqual(loser['after_lower_podium'], {'value': 0, 'n': 3})
        self.assertEqual(loser['assets_mean']['value'], -10)
        self.assertEqual(winner['destination_mean']['value'], 0)
        # Conditional opportunities can be absent in a whole analysis window.
        # Omit the pair; never turn no opportunity into a zero-valued observation.
        self.assertAlmostEqual(a.pearson([1, None, 3, 4], [4, 9, 2, 1]), -1)
        self.assertIsNone(a.pearson([None, None, 3, 4], [4, 9, 2, 1]))

    def test_fixed_boundary_equality_direction_and_no_forced_full_score(self):
        definition = {'thresholds': list(range(2, 11))}
        self.assertEqual([a.score(v, definition, 1) for v in [-3, 1, 2, 2.001, 9, 10, 100]], [1, 1, 2, 2, 9, 10, 10])
        self.assertIsNone(a.score(None, definition, 1))
        lower_better = {'thresholds': [-3.9, -3.8, -3.7, -3.6, -3.5, -3.4, -3.3, -3.2, -3.1]}
        self.assertLess(a.score(3.9, lower_better, -1), a.score(3.2, lower_better, -1))
        self.assertTrue(all(a.score(value, definition, 1) < 10 for value in [3, 4, 5, 7]))
        frozen = copy.deepcopy(definition)
        a.score(999, definition, 1)
        self.assertEqual(definition, frozen)

    def test_interpolation_extrapolation_and_degenerate_reference(self):
        self.assertEqual(a.quantile([0, 10, 20, 30], .25), 7.5)
        definition = a.threshold_definition(list(range(101)), 'spread', 1)
        self.assertEqual(definition['rawThresholds'][-1], 114)
        self.assertEqual(a.score(100, definition, 1), 9)
        self.assertIsNone(a.threshold_definition([0] * 100, 'spread', 1)['thresholds'])

    def test_perfect_bounded_rate_can_reach_full_score(self):
        # Extending the observed upper spread must not require a rate above 100%.
        values = [.80, .85, .90, .95, .95, .95, 1., 1., 1., 1.]
        definition = a.threshold_definition(values, 'spread', 1, upper_bound=1)
        self.assertEqual(definition['thresholds'][-1], 1)
        self.assertEqual(a.score(1, definition, 1), 10)
        self.assertTrue(all(a < b for a, b in zip(definition['thresholds'], definition['thresholds'][1:])))

    def test_axis_scores_have_no_aggregate_and_keep_missing_separate(self):
        players, matches = a.prepare(fixture())
        ids = [p['id'] for p in players]
        baseline = {'axes': {key: {'status': 'ready', 'thresholds': [i / 10 for i in range(1, 10)]}
                             for key, (_, direction, _) in a.METRICS.items() if direction}}
        result = a.evaluate(matches, ids, baseline)
        self.assertEqual(set(result), {'n', 'events', 'raw', 'scores'})
        self.assertEqual(result['scores']['A']['rank_mean']['score'], 1)
        self.assertEqual(result['scores']['A']['rank_mean']['status'], 'reference')
        self.assertEqual(result['scores']['A']['after_lower_podium']['status'], 'no_target')
        self.assertIsNone(result['scores']['A']['after_lower_podium']['score'])
        # An unavailable conditional axis must not hide another observed axis.
        self.assertIsNotNone(result['scores']['A']['assets_median']['score'])
        sensitivity = a.perturbation(matches, ids, baseline, 'no_destination6', detailed=True)
        self.assertEqual(sensitivity['points']['A']['rank_mean']['unavailable'], 1)
        self.assertIsNone(sensitivity['maxPointChange'])
        result = a.evaluate(matches, ids, {**baseline, 'window': 20}, full_min=3, event_min=1)
        self.assertEqual(result['scores']['A']['rank_mean']['status'], 'ready')
        self.assertEqual(result['scores']['A']['assets_max']['status'], 'reference_opportunity')

    def test_missing_map_calibration_never_silently_falls_back(self):
        common = {'id': 'common', 'axes': {key: {'thresholds': [1], 'status': 'ready'}
                                          for key, (_, direction, _) in a.METRICS.items() if direction}}
        unavailable = {'id': 'map', 'axes': {key: {'thresholds': None, 'status': 'insufficient_calibration'}
                                            for key in common['axes']}}
        selected = a.combine_baseline(common, unavailable, 'hybrid')
        self.assertEqual(selected['axes']['rank_mean']['status'], 'ready')
        self.assertIsNone(selected['axes']['assets_mean']['thresholds'])
        self.assertIsNone(a.score(500, selected['axes']['assets_mean'], 1))

    def test_incomplete_export_and_roster_mismatch_fail_closed(self):
        source = fixture()
        source['totalMatchCount'] += 1
        with self.assertRaisesRegex(ValueError, 'truncated'):
            a.prepare(source)
        source = fixture()
        source['matches'][0]['players'][0]['id'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'Roster'):
            a.prepare(source)

    def test_review_advisory_needs_persistent_broad_concentration(self):
        self.assertEqual(a.review_status([{'revenue': 1}, {'revenue': 1}], 8)['status'], 'no_review_signal')
        self.assertEqual(a.review_status([{'revenue': 3}, {'revenue': 1}], 8)['status'], 'no_review_signal')
        self.assertEqual(a.review_status([{'revenue': 3, 'assets': 0}, {'revenue': 0, 'assets': 3}], 8)['axes'], [])
        self.assertEqual(a.review_status([{'revenue': 3}, {'revenue': 3}], 8), {'status': 'review_suggested', 'axes': ['revenue']})
        self.assertEqual(a.review_status([{'revenue': 4}, {'revenue': 4}], 7)['status'], 'insufficient_new_records')
        self.assertEqual(a.review_status([{'revenue': 4}], 8)['status'], 'insufficient_new_records')


if __name__ == '__main__':
    unittest.main()
