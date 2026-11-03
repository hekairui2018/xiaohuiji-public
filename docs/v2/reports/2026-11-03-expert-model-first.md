# Expert owns tool decisions

Available expert sessions now enter the model before product/file retrieval or ordering calculation. The model selects the existing deterministic calculator with quoted customer conditions. Validated calculation results are delivered immediately without a second model call. A model-selected quick tool also delivers complete answers or file cards immediately; uncertain candidates continue to the model. The legacy ordering URL also respects explicitly requested expert mode. Downloads selected by the model remain available.

When the model is unavailable the interface disables expert selection and switches to quick mode. Connection status is refreshed and checked before expert selection and sending. Model-offline responses retry in quick mode; evidence validation failures do not trigger fallback.

Focused regression: 57 tests passed. Separate SQL/ordering suite: 13 passed, one pre-existing numeric-validation test failed; this is not a fully green repository suite. Private source data and ordering strategy are excluded. The bounded integration patch documents the core changes without publishing private ordering implementation.
