WARNING:  database "runapp" has no actual collation version, but a version was recorded
--
-- PostgreSQL database dump
--

\restrict oM43UOIbQK8v9weBuS7ZSDZ7PaXL7BmLiHZofUGbCZBKghtodeDs5pucJnQuctJ

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.apps DROP CONSTRAINT IF EXISTS fk_apps_server;
DROP INDEX IF EXISTS public.idx_users_deleted_at;
DROP INDEX IF EXISTS public.idx_servers_deleted_at;
DROP INDEX IF EXISTS public.idx_projects_deleted_at;
DROP INDEX IF EXISTS public.idx_audit_logs_deleted_at;
DROP INDEX IF EXISTS public.idx_apps_deleted_at;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS uni_users_username;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS uni_projects_name;
ALTER TABLE IF EXISTS ONLY public.servers DROP CONSTRAINT IF EXISTS servers_pkey;
ALTER TABLE IF EXISTS ONLY public.projects DROP CONSTRAINT IF EXISTS projects_pkey;
ALTER TABLE IF EXISTS ONLY public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_pkey;
ALTER TABLE IF EXISTS ONLY public.apps DROP CONSTRAINT IF EXISTS apps_pkey;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.servers;
DROP TABLE IF EXISTS public.projects;
DROP TABLE IF EXISTS public.audit_logs;
DROP TABLE IF EXISTS public.apps;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    domain text NOT NULL,
    compose_path text NOT NULL,
    project_id uuid,
    server_id uuid,
    app_url text,
    auto_stop_mins bigint DEFAULT 60 NOT NULL,
    status text DEFAULT 'stopped'::text NOT NULL,
    started_at timestamp with time zone,
    timer_ends_at bigint,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    username text NOT NULL,
    action text NOT NULL,
    resource_id uuid,
    resource_type text NOT NULL,
    resource_name text NOT NULL,
    details text,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    ssh_user text NOT NULL,
    ssh_port bigint DEFAULT 22 NOT NULL,
    ssh_key_encrypted text NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    last_checked bigint,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    email text NOT NULL,
    full_name text,
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Data for Name: apps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.apps (id, name, domain, compose_path, project_id, server_id, app_url, auto_stop_mins, status, started_at, timer_ends_at, created_at, updated_at, deleted_at) FROM stdin;
574a9856-45ba-4c07-9043-60d673269120	Auto	auto.qms.nexgensis.com	/root/qms/auto-qms	24e23509-75bd-405e-8fa2-3cd57f5aa9aa	23604782-d9cc-4df3-96a5-c6d38b2f6980		0	running	2026-01-09 11:05:29.719996+00	\N	2026-01-09 11:04:35.659999+00	2026-01-09 11:05:35.675386+00	\N
7eb4f1f5-ad82-4dae-8e12-09592c662b2b	Staging	pharma.qms.nexgensis.com	/root/qms/pharma-qms	aa7c93ec-cad3-49ad-97f8-630432b75671	9ea07ec5-e2c5-41d3-adc6-e124a4e8654d		0	running	2025-11-13 08:13:39.145847+00	\N	2025-11-07 11:34:51.886656+00	2025-11-13 08:14:43.342804+00	\N
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, user_id, username, action, resource_id, resource_type, resource_name, details, ip_address, user_agent, created_at, updated_at, deleted_at) FROM stdin;
6f1a08f7-d922-4ccb-b543-dcbce3bf790a	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 1h0m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-07 13:45:43.634592+00	2025-11-07 13:45:43.634592+00	\N
f6668e4c-221e-485e-9f5c-643988a0d31c	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 27.136547575s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-07 13:46:10.770461+00	2025-11-07 13:46:10.770461+00	\N
a6772d0f-ac98-42a1-9d60-f58151dcdc75	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 2h0m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 06:02:25.043891+00	2025-11-13 06:02:25.043891+00	\N
dd427f98-1edf-403a-b549-8dd6182dcafa	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 28.876164012s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 06:02:53.91918+00	2025-11-13 06:02:53.91918+00	\N
6905596c-3b5e-4cd2-82e7-0ca0297322bc	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	create_user	2a701648-3483-4726-9f67-e2a1445e0621	user	abhi	User created by admin	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:37:42.21205+00	2025-11-13 07:37:42.21205+00	\N
90b89290-4e5b-4874-9aef-7e7957be7c5a	2a701648-3483-4726-9f67-e2a1445e0621	abhi	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 2h0m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:38:18.333067+00	2025-11-13 07:38:18.333067+00	\N
9f1c0a46-8c49-40cf-9e2f-fe6536b1f8f5	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 20.480230754s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:38:38.812211+00	2025-11-13 07:38:38.812211+00	\N
04259774-d528-41b8-8d7d-1a49483e3afe	2a701648-3483-4726-9f67-e2a1445e0621	abhi	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 24h0m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:38:54.590454+00	2025-11-13 07:38:54.590454+00	\N
d72081dd-7e69-4551-b303-912c504b892c	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 24.258852403s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:39:18.848473+00	2025-11-13 07:39:18.848473+00	\N
47423048-a2f7-4c93-834f-ec40b0a44e16	2a701648-3483-4726-9f67-e2a1445e0621	abhi	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 15m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:39:37.594122+00	2025-11-13 07:39:37.594122+00	\N
7a1b49b9-dfbd-4a36-bdbb-e2a836244630	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 15m3.388671909s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:54:41.001014+00	2025-11-13 07:54:41.001014+00	\N
16c7ca52-cbe1-4059-b581-3355b8d6edad	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 15m3.479248079s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:54:41.071606+00	2025-11-13 07:54:41.071606+00	\N
34eaa261-7b25-46db-91da-46fc9d04ac56	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 15m3.494788674s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:54:41.086515+00	2025-11-13 07:54:41.086515+00	\N
98bce8b8-934b-4453-a7e2-d188eec6562a	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 15m4.51028712s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:54:42.104585+00	2025-11-13 07:54:42.104585+00	\N
dc1b880d-fd47-4214-a94c-20803241b782	2a701648-3483-4726-9f67-e2a1445e0621	abhi	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 5m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 07:58:38.142148+00	2025-11-13 07:58:38.142148+00	\N
c775c957-283a-412f-b258-28f89fbb1dbe	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 5m2.383395108s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 08:03:40.521309+00	2025-11-13 08:03:40.521309+00	\N
00ef3d5f-de3e-4ebc-adcd-ea532d6e00da	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 5m2.905177458s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 08:03:41.045305+00	2025-11-13 08:03:41.045305+00	\N
f0b8ad41-13da-4f52-82f5-5960556b121d	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 5m2.905350805s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 08:03:41.045833+00	2025-11-13 08:03:41.045833+00	\N
913771b6-2da3-4bb6-bfa6-f49693a4f143	2a701648-3483-4726-9f67-e2a1445e0621	abhi	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 15m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 08:05:39.425712+00	2025-11-13 08:05:39.425712+00	\N
97785d12-c7c1-469a-92a7-e28027148114	2a701648-3483-4726-9f67-e2a1445e0621	abhi	stop_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 7m48.584807812s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 08:13:27.99123+00	2025-11-13 08:13:27.99123+00	\N
be111d4d-5dcd-409c-96df-33bf5d723d05	2a701648-3483-4726-9f67-e2a1445e0621	abhi	start_app	7eb4f1f5-ad82-4dae-8e12-09592c662b2b	app	Staging	App: Staging on server 9ea07ec5-e2c5-41d3-adc6-e124a4e8654d, Duration: 5m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 08:13:39.168515+00	2025-11-13 08:13:39.168515+00	\N
f09e6bdf-2617-473b-8aba-cedf2e728ea1	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	update_user	64c85770-496b-44fd-b90d-2c3fb4dacb55	user	sourav	User updated by admin	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2025-11-13 09:40:01.792502+00	2025-11-13 09:40:01.792502+00	\N
7ded9e56-d079-4e8b-b34e-1f0ab7b153ca	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	start_app	574a9856-45ba-4c07-9043-60d673269120	app	Auto	App: Auto on server 23604782-d9cc-4df3-96a5-c6d38b2f6980, Duration: 1h0m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36	2026-01-09 11:05:05.465719+00	2026-01-09 11:05:05.465719+00	\N
82d67889-14dc-4efe-8ccf-4a5018692441	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	stop_app	574a9856-45ba-4c07-9043-60d673269120	app	Auto	App: Auto on server 23604782-d9cc-4df3-96a5-c6d38b2f6980, Duration: 15.366807451s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36	2026-01-09 11:05:20.83349+00	2026-01-09 11:05:20.83349+00	\N
fd4f1486-757c-4db2-9e9b-6a512da714af	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	start_app	574a9856-45ba-4c07-9043-60d673269120	app	Auto	App: Auto on server 23604782-d9cc-4df3-96a5-c6d38b2f6980, Duration: 1h0m0s	172.18.0.4	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36	2026-01-09 11:05:29.721677+00	2026-01-09 11:05:29.721677+00	\N
5febdba5-1e96-4a44-a952-17a21d305655	64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	update_user	2a701648-3483-4726-9f67-e2a1445e0621	user	abhi	User updated by admin	172.18.0.1	Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0	2026-05-16 09:56:18.182212+00	2026-05-16 09:56:18.182212+00	\N
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.projects (id, name, description, created_at, updated_at, deleted_at) FROM stdin;
aa7c93ec-cad3-49ad-97f8-630432b75671	Batch Genius		2025-11-07 11:31:00.418823+00	2025-11-07 11:31:00.418823+00	\N
24e23509-75bd-405e-8fa2-3cd57f5aa9aa	QMS		2026-01-09 11:03:19.610491+00	2026-01-09 11:03:19.610491+00	\N
\.


--
-- Data for Name: servers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.servers (id, name, address, ssh_user, ssh_port, ssh_key_encrypted, status, last_checked, created_at, updated_at, deleted_at) FROM stdin;
9ea07ec5-e2c5-41d3-adc6-e124a4e8654d	Staging	89.116.20.193	root	22	-----BEGIN OPENSSH PRIVATE KEY-----\n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\n-----END OPENSSH PRIVATE KEY-----\n	online	1762515049	2025-11-07 11:30:49.982706+00	2025-11-07 11:30:49.982706+00	\N
23604782-d9cc-4df3-96a5-c6d38b2f6980	DEMO	89.116.20.193	root	22	-----BEGIN OPENSSH PRIVATE KEY-----\n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\n-----END OPENSSH PRIVATE KEY-----\n	online	1767956590	2026-01-09 11:03:10.765748+00	2026-01-09 11:03:10.765748+00	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, password_hash, role, email, full_name, is_active, last_login_at, created_at, updated_at, deleted_at) FROM stdin;
64c85770-496b-44fd-b90d-2c3fb4dacb55	sourav	$2a$14$SO2O2DnIF2PeGtbLshrGlO7N1o52puEAdo5oXWt2U4LqnCdzVHl9m	admin	sourav@example.com	Sourav Kumar	t	\N	2025-11-07 11:28:44.717689+00	2025-11-13 09:40:01.790487+00	\N
f586b3a4-9684-4532-b11b-8980633d293b	Sourav.kumar		user	Sourav.kumar@nexgensis.com	Sourav Kumar	t	\N	2026-01-09 06:35:25.077383+00	2026-01-09 06:35:25.077383+00	\N
2a701648-3483-4726-9f67-e2a1445e0621	abhi	$2a$14$3Iargkrtl8TWL9AJNdMEjemXdbhp9TaCRZs0c.3gqCCywVU1aJMMq	admin	admin@nexgensis.com	abhi	t	\N	2025-11-13 07:37:42.208182+00	2026-05-16 09:56:18.176115+00	\N
\.


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: servers servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servers
    ADD CONSTRAINT servers_pkey PRIMARY KEY (id);


--
-- Name: projects uni_projects_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uni_projects_name UNIQUE (name);


--
-- Name: users uni_users_username; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uni_users_username UNIQUE (username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_apps_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_deleted_at ON public.apps USING btree (deleted_at);


--
-- Name: idx_audit_logs_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_deleted_at ON public.audit_logs USING btree (deleted_at);


--
-- Name: idx_projects_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_deleted_at ON public.projects USING btree (deleted_at);


--
-- Name: idx_servers_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servers_deleted_at ON public.servers USING btree (deleted_at);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at);


--
-- Name: apps fk_apps_server; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT fk_apps_server FOREIGN KEY (server_id) REFERENCES public.servers(id);


--
-- PostgreSQL database dump complete
--

\unrestrict oM43UOIbQK8v9weBuS7ZSDZ7PaXL7BmLiHZofUGbCZBKghtodeDs5pucJnQuctJ

