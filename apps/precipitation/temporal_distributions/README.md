# Temporal Distribution CSV Library

Place temporal-distribution CSV files in this folder. The app loads every `*.csv` file in this folder at startup.

Required data columns:

```csv
fraction_time,fraction_cumulative_depth
0.0000,0.0000
0.5000,0.5000
1.0000,1.0000
```

Rules:
- `fraction_time` must range from 0 to 1.
- `fraction_cumulative_depth` must range from 0 to 1.
- Time fractions must be strictly increasing.
- Cumulative-depth fractions must be nondecreasing.
- Missing endpoints are inserted only when the remaining curve is valid.

Optional metadata comments can be placed above the header:

```csv
# distribution_name: NOAA14 TX 2-1Q90
# source_note: Source or derivation note
fraction_time,fraction_cumulative_depth
0.0000,0.0000
1.0000,1.0000
```

To add a curve such as `NOAA14-tx-2-1Q90.csv`, place the completed CSV in this folder and restart the Dash app.
