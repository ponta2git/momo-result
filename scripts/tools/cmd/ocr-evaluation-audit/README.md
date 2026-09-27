# OCR evaluation audit

This tool checks sample independence and estimates sample requirements for paired OCR evaluation.
It guards against two optimistic mistakes:

1. counting copied image files as independent holdout samples; and
2. declaring a release-sized holdout from baseline accuracy before observing paired Rust/Python
   discordance and match-level clustering.

The dataset report first applies the current evaluator filename contract, then hashes eligible image
content without emitting hashes or filenames. It reports ignored image files, duplicate groups
across all supplied directories, and unique images above the configured dimensions. JPEG and PNG
are supported; WebP is recognized as an input extension but fails closed until its decoder is added.
An audit with no eligible images fails, including when ignored images are explicitly allowed.
Repeated references to the same directory (including symlink aliases) are rejected rather than
counted as duplicate samples. Content equality means identical file bytes; different encodings,
near-duplicate screenshots, and match-level dependence still require separate assessment.

The planning report assumes equal Rust/Python marginal accuracy and disjoint errors, then computes
a one-sided normal-approximation floor for a paired noninferiority comparison. It emits both a
baseline point-estimate floor and a more conservative floor based on the one-sided Wilson upper
bound of the baseline error rate.

These are collection-planning floors, not a release verdict. Before locking the release holdout,
run both engines on a development-only paired pilot, use an upper confidence bound for observed
discordance, and run a match-cluster power simulation. The final release set must remain unseen by
calibration and implementation work.
