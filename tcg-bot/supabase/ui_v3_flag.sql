-- The v3 screens flag (UI-00 foundation, Nathan 2026-10-07): settings.ui_v3 = {"enabled": bool, "users": [member ids]}.
-- The Activity server reads it (/api/flags uiV3). A listed member sees each v3 screen before everyone; "enabled" opens
-- them to all. It starts off and empty: the member ids are set live, not in this public repo. Idempotent.
insert into public.settings (key, value) values ('ui_v3', '{"enabled": false, "users": []}'::jsonb)
on conflict (key) do nothing;
