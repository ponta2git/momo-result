use super::*;

#[test]
#[expect(
    clippy::panic_in_result_fn,
    reason = "test setup propagates solver errors while numerical assertions report the oracle mismatch"
)]
fn penalized_fit_matches_an_independent_one_dimensional_optimum() -> Result<(), &'static str> {
    // For one winning observation x=1, the specified L2 objective is
    // ln(1 + exp(-b)) + b²/2. Its unique minimum solves b = 1/(1 + exp(b)).
    // The reference was obtained by decimal bisection, independently of Newton's method.
    let expected = 0.401_058_137_541_547_f64;
    let mut win = [Observation {
        features: [1.0],
        outcome: 1.0,
    }];
    let win_fit = fit(&mut win).map_err(|()| "winning observation did not converge")?;
    let [coefficient] = win_fit.coefficients;
    assert!((coefficient - expected).abs() < 1e-8);

    let mut loss = [Observation {
        features: [1.0],
        outcome: 0.0,
    }];
    let loss_fit = fit(&mut loss).map_err(|()| "losing observation did not converge")?;
    let [opposite] = loss_fit.coefficients;
    assert!((opposite + expected).abs() < 1e-8);

    let [win_observation] = win;
    let [loss_observation] = loss;
    let mut balanced = [win_observation, loss_observation];
    let balanced_fit = fit(&mut balanced).map_err(|()| "balanced observations did not converge")?;
    assert!(
        balanced_fit
            .coefficients
            .iter()
            .all(|value| value.abs() < f64::EPSILON)
    );
    assert_eq!(probability(&[1.0], &balanced_fit.coefficients), Ok(0.5));
    Ok(())
}

#[test]
#[expect(
    clippy::panic_in_result_fn,
    reason = "test setup propagates solver errors while numerical assertions report the oracle mismatch"
)]
fn evaluation_metrics_use_the_observation_denominator() -> Result<(), &'static str> {
    // log(3) gives odds 3:1, hence p=3/4. With one win and one loss:
    // Brier = ((1/4)² + (3/4)²)/2; log loss = -ln((3/4)(1/4))/2.
    let coefficients = [3.0_f64.ln()];
    let observations = [
        Observation {
            features: [1.0],
            outcome: 1.0,
        },
        Observation {
            features: [1.0],
            outcome: 0.0,
        },
    ];
    let actual_probability =
        probability(&[1.0], &coefficients).map_err(|()| "invalid probability")?;
    let actual_brier =
        brier_score(&observations, &coefficients).map_err(|()| "invalid Brier score")?;
    let actual_loss = log_loss(&observations, &coefficients).map_err(|()| "invalid log loss")?;
    assert!((actual_probability - 0.75).abs() < 1e-14);
    assert!((actual_brier - 0.3125).abs() < 1e-14);
    assert!((actual_loss - 0.836_988_216_785_835_8).abs() < 1e-14);
    assert!(log_loss::<1>(&[], &coefficients).is_err());
    assert!(brier_score::<1>(&[], &coefficients).is_err());
    Ok(())
}
