-- WhatsApp template notifications (class reminder, class check, class done, tutor applied, demo scheduled).
-- Off until switched on:   update public.app_settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'whatsapp';
-- agency_phone is the number every template shows as "our agency" (change it here, no template change needed).
insert into public.app_settings (key, value) values ('whatsapp', '{"enabled": false, "agency_phone": "+91 90018 00307"}')
on conflict (key) do nothing;
