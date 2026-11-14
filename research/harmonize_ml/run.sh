#!/bin/sh
# PROTOTYPE runner. LightGBM and XGBoost need libomp, which this Mac does not have system-wide;
# scikit-learn ships a copy, so point the loader at it instead of installing anything.
# Usage: research/harmonize_ml/run.sh loyo|oot|twin          -> run.py
#        research/harmonize_ml/run.sh improve [--ml]         -> improve.py
set -e
cd "$(dirname "$0")/../.."
WITH="--with scikit-learn --with lightgbm --with catboost --with xgboost"
OMP=$(uv run $WITH python -c "import sklearn, pathlib; print(next(pathlib.Path(sklearn.__file__).parent.rglob('libomp.dylib')).parent)" 2>/dev/null || true)
script=run.py
if [ "$1" = "improve" ]; then script=improve.py; shift; fi
DYLD_LIBRARY_PATH="$OMP" uv run $WITH python "research/harmonize_ml/$script" "$@"
