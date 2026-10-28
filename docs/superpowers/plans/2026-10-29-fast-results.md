# Quickly cycling weapon results

The user reports that after-match results cycle over weapons quickly. The existing two-second scout plus one-second confirmation can miss short cards.

Keep gameplay capture at one requested FPS, with tiny layout probes once per second and no OCR unless a candidate layout is visible. Temporarily request four FPS and poll cropped results every 250 ms after a results candidate appears. Preserve the original capture resolution constraints when changing rate. Hold through transitions for four seconds, cap a results burst at 90 seconds, and restore one FPS outside results. Use one serial OCR worker and no frame queue or persisted screenshots. Keep the first confirmation timestamp instead of restarting it on every fast check; require another matching observation after at least 200 ms. Bind weapon and reward crops to the same sampled frame. Existing camo overview scans remain at their slower cadence.

Validate using real OCR on a simulated carousel with two different weapons, a short attachment interlude, and a return to blank gameplay. Verify each camo belongs to the correct weapon, no attachment is applied, capture rate restores, no work survives Stop, and existing overview/idle/manual correction behavior still works. Very brief cards, slow OCR, unavailable capture rates and browser throttling can still cause misses; do not guarantee every unlock.
