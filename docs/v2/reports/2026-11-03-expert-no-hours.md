# Expert operating-hours restriction disabled

At the user's request, expert mode no longer closes at 18:00 or waits until 08:30. The default protection schedule is disabled; explicit opt-in remains available for restoring the former window. Temperature protection remains at 85°C.

The dependency watchdog can recover the model regardless of hour. The former scheduled daily start and stop tasks are disabled, with their prior states and definitions retained privately. Manual model start/stop remains available.

Twenty related protection/concurrency/queue tests passed. Clock-controlled checks cover midnight, early morning, 18:00 and late evening; each permits model requests and still trips at 85°C. The public protection test subset has eleven passing tests. Development deployment preserves the previous runtime for rollback and changes one backend module; original data and the remaining backend modules are preserved.
