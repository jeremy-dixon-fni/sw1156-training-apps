# Temporal Distribution Library

Add deployed distribution CSV filenames to `manifest.json`. Static browsers cannot enumerate a directory, so the manifest is required.

Required columns:

```csv
fraction_time,fraction_cumulative_depth
0,0
...
1,1
```

The filename stem is used as the dropdown label.
