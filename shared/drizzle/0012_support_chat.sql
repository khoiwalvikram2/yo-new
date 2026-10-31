CREATE TABLE support_chat_settings (
 tenant varchar(128) PRIMARY KEY REFERENCES whitelabels(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,title varchar(80) NOT NULL DEFAULT 'Live support',
 welcome_message text NOT NULL DEFAULT 'Hello! How can we help you today?',
 offline_message text NOT NULL DEFAULT 'Our team is away. Leave a message and we will reply here.',
 timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',open_minute integer NOT NULL DEFAULT 540,close_minute integer NOT NULL DEFAULT 1260,
 days smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(open_minute BETWEEN 0 AND 1439 AND close_minute BETWEEN 1 AND 1440 AND open_minute<>close_minute),
 CHECK(cardinality(days)>0 AND days <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);
--> statement-breakpoint
CREATE TABLE support_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant varchar(128) NOT NULL REFERENCES whitelabels(id) ON DELETE CASCADE,
 player_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,topic varchar(24) NOT NULL DEFAULT 'Account',
 status varchar(16) NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','assigned','resolved')),
 assigned_kind varchar(8),assigned_id varchar(128),assigned_name varchar(120),last_seq bigint NOT NULL DEFAULT 0,
 player_read_seq bigint NOT NULL DEFAULT 0,staff_read_seq bigint NOT NULL DEFAULT 0,player_delivered_seq bigint NOT NULL DEFAULT 0,staff_delivered_seq bigint NOT NULL DEFAULT 0,
 last_message_preview varchar(180) NOT NULL DEFAULT '',last_message_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX support_one_open_player ON support_conversations(tenant,player_id) WHERE status<>'resolved';
CREATE INDEX support_inbox_idx ON support_conversations(tenant,status,last_message_at DESC,id);
CREATE INDEX support_player_idx ON support_conversations(tenant,player_id,last_message_at DESC,id);
--> statement-breakpoint
CREATE TABLE support_messages (
 seq bigserial PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
 tenant varchar(128) NOT NULL,sender_kind varchar(8) NOT NULL CHECK(sender_kind IN ('player','admin','crm','system')),sender_id varchar(128) NOT NULL,
 sender_name varchar(120) NOT NULL,client_message_id uuid NOT NULL,body text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_kind,sender_id,client_message_id)
);
CREATE INDEX support_messages_page_idx ON support_messages(tenant,conversation_id,seq);
CREATE INDEX support_sender_rate_idx ON support_messages(tenant,sender_kind,sender_id,created_at);
--> statement-breakpoint
CREATE TABLE support_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,tenant varchar(128) NOT NULL,
 sender_kind varchar(8) NOT NULL,sender_id varchar(128) NOT NULL,message_seq bigint REFERENCES support_messages(seq) ON DELETE CASCADE,
 filename varchar(120) NOT NULL,mime varchar(32) NOT NULL,size integer NOT NULL CHECK(size BETWEEN 1 AND 2097152),data bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_attachment_message_idx ON support_attachments(message_seq);
CREATE INDEX support_attachment_owner_idx ON support_attachments(tenant,sender_kind,sender_id,created_at);
--> statement-breakpoint
CREATE TABLE support_presence (
 tenant varchar(128) NOT NULL REFERENCES whitelabels(id) ON DELETE CASCADE,kind varchar(8) NOT NULL,staff_id varchar(128) NOT NULL,name varchar(120) NOT NULL,
 available boolean NOT NULL DEFAULT false,last_seen_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant,kind,staff_id)
);
CREATE INDEX support_presence_tenant_idx ON support_presence(tenant,last_seen_at);
--> statement-breakpoint
INSERT INTO permissions(tenant,domain,action)
SELECT w.id,'support.chat',a FROM whitelabels w CROSS JOIN unnest(ARRAY['view','reply','assign','settings']) a
ON CONFLICT(tenant,domain,action) DO NOTHING;
INSERT INTO role_permissions(tenant,role_id,permission_id)
SELECT r.tenant,r.id,p.id FROM roles r JOIN permissions p ON p.tenant=r.tenant AND p.domain='support.chat' WHERE r.is_whitelabel_admin
ON CONFLICT(role_id,permission_id,tenant) DO NOTHING;
INSERT INTO crm_role_permissions(role_id,domain,action)
SELECT DISTINCT p.role_id,'crm.chat',a FROM crm_role_permissions p CROSS JOIN unnest(ARRAY['view','reply','assign']) a
WHERE p.domain='crm.roles' AND p.action='manage' ON CONFLICT DO NOTHING;
