-- Console editorial-provider catalog
-- Apply after the Console alpha and operator-setup migrations. These values
-- permit pending connection records only; no application receives provider
-- credentials or write access from this migration.

alter type public.integration_provider add value if not exists 'lucidlink';
alter type public.integration_provider add value if not exists 'avid_media_composer';
alter type public.integration_provider add value if not exists 'adobe_premiere_pro';
alter type public.integration_provider add value if not exists 'davinci_resolve';

-- Alpha safety guard: these additions expand the connection catalog only.
-- They do not create a connector, companion agent, cloud-storage mount,
-- provider token, transfer worker, or deletion capability.
