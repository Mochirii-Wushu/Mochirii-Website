<?php

return [
    'mastodon' => [
        'enabled' => env('PF_LOGIN_WITH_MASTODON_ENABLED', false),
        'ignore_closed_state' => env('PF_LOGIN_WITH_MASTODON_ENABLED_SKIP_CLOSED', false),

        'contraints' => [
            /*
             *   Skip email verification
             *
             *   To improve the onboarding experience, you can opt to skip the email
             *   verification process and automatically verify their email
             */
            'skip_email_verification' => env('PF_LOGIN_WITH_MASTODON_SKIP_EMAIL', true),
        ],

        'domains' => [
            'default' => 'mastodon.social,mastodon.online,mstdn.social,mas.to',

            /*
             *   Custom legacy import domains
             *
             *   Define a comma separated list of custom domains to allow
             */
            'custom' => env('PF_LOGIN_WITH_MASTODON_DOMAINS'),

            /*
             *   Use only default domains
             *
             *   Allow legacy import sign-in using only the default domains
             */
            'only_default' => env('PF_LOGIN_WITH_MASTODON_ONLY_DEFAULT', false),

            /*
             *   Use only custom domains
             *
             *   Allow legacy import sign-in using only the custom domains
             *   you define, in comma separated format
             */
            'only_custom' => env('PF_LOGIN_WITH_MASTODON_ONLY_CUSTOM', false),
        ],

        'max_uses' => [
            /*
             *   Max Uses
             *
             *   Legacy import protections can limit repeat import use when that flow is enabled.
             *   This staging environment keeps that flow disabled and redirects public routes to
             *   the standard Mochirii Social login.
             */
            'enabled' => env('PF_LOGIN_WITH_MASTODON_ENFORCE_MAX_USES', true),
            'limit' => env('PF_LOGIN_WITH_MASTODON_MAX_USES_LIMIT', 3)
        ]
    ],

    'oidc' => [
        /*
         *   Enable OIDC authentication
         *
         *   Enable Sign-in with OpenID Connect (OIDC) authentication providers
         */
        'enabled' => env('PF_OIDC_ENABLED', false),

        /*
         *   Client ID
         *
         *   The client ID provided by your OIDC provider
         */
        'clientId' => env('PF_OIDC_CLIENT_ID', false),

        /*
         *   Client Secret
         *
         *   The client secret provided by your OIDC provider
         */
        'clientSecret' => env('PF_OIDC_CLIENT_SECRET', false),

        /*
         *   OAuth Scopes
         *
         *   The scopes to request from the OIDC provider, typically including
         *   'openid' (required), 'profile', and 'email' for basic user information
         */
        'scopes' =>  env('PF_OIDC_SCOPES', 'openid profile email'),

        /*
         *   Authorization URL
         *
         *   The endpoint used to start the OIDC authentication flow
         */
        'authorizeURL' => env('PF_OIDC_AUTHORIZE_URL', ''),

        /*
         *   Token URL
         *
         *   The endpoint used to exchange the authorization code for an access token
         */
        'tokenURL' => env('PF_OIDC_TOKEN_URL', ''),

        /*
         *   Profile URL
         *
         *   The endpoint used to retrieve user information with a valid access token
         */
        'profileURL' => env('PF_OIDC_PROFILE_URL', ''),

        /*
         * Bound each server-to-server OIDC request. The callback performs at
         * most one token request and one profile request.
         */
        'request_timeout' => max(1, min(15, (int) env('PF_OIDC_REQUEST_TIMEOUT', 10))),

        /*
         *   Logout URL
         *
         *   The endpoint used to log the user out of the OIDC provider
         */
        'logoutURL' => env('PF_OIDC_LOGOUT_URL', ''),

        /*
         *   Username Field
         *
         *   The field from the OIDC profile response to use as the username
         *   Default is 'preferred_username' but can be changed based on your provider
         */
        'field_username' => env('PF_OIDC_USERNAME_FIELD', "preferred_username"),

        /*
         *   ID Field
         *
         *   The field from the OIDC profile response to use as the unique identifier
         *   Default is 'sub' (subject) which is standard in OIDC implementations
         */
        'field_id' => env('PF_OIDC_FIELD_ID', 'sub'),
    ],

    'social_sync' => [
        /*
         * Mochirii Social account sync
         *
         * The Pixelfed runtime calls a Supabase Edge Function after a successful
         * OIDC callback so the website Account page can show linked social
         * status. The Supabase service role key stays in Supabase; the host
         * keeps only this narrow shared secret.
         */
        'endpoint' => env('MOCHIRII_SOCIAL_SYNC_URL', ''),
        'secret' => env('MOCHIRII_SOCIAL_SYNC_SECRET', ''),
        'timeout' => max(1, min(10, (int) env('MOCHIRII_SOCIAL_SYNC_TIMEOUT', 5))),
    ],

    'raffle_leaderboard' => [
        /*
         * Private Mōchirīī raffle leaderboard reader
         *
         * The host signs each request with a dedicated HMAC secret. The
         * secret never leaves the host and must not be reused by account sync
         * or any browser-facing surface.
         */
        'endpoint' => env('MOCHIRII_RAFFLE_LEADERBOARD_URL', ''),
        'secret' => env('MOCHIRII_RAFFLE_LEADERBOARD_SECRET', ''),
        'timeout' => max(1, min(10, (int) env('MOCHIRII_RAFFLE_LEADERBOARD_TIMEOUT', 5))),
    ],
];
