<?php

return [
    /*
    | Member media is served only through the authenticated same-origin
    | gateway. Static application artwork remains on the public disk.
    */
    'enabled' => (bool) env('MOCHIRII_PRIVATE_MEDIA_ENABLED', true),

    /* Keep cloud grants short enough to limit reuse while allowing a player
       to follow the redirect and begin an image or video request. */
    'temporary_url_seconds' => max(
        10,
        min(60, (int) env('MOCHIRII_PRIVATE_MEDIA_URL_TTL_SECONDS', 20))
    ),

    /*
    | A completed two-factor checkpoint is bound to the current factor and,
    | for native clients, the exact OAuth bearer token. Browser sessions and
    | native assertions use the same bounded freshness window.
    */
    'two_factor_assurance_seconds' => max(
        300,
        min(43_200, (int) env('MOCHIRII_PRIVATE_MEDIA_2FA_TTL_SECONDS', 43_200))
    ),

    /*
    | Independent identity and address ceilings limit enumeration and bulk
    | extraction without treating a shared NAT address as the only actor.
    */
    'rate_limits' => [
        'requests_per_minute_per_identity' => 240,
        'requests_per_minute_per_ip' => 360,
        'checkpoints_per_minute_per_identity' => 5,
        'checkpoints_per_hour_per_identity' => 15,
        'checkpoints_per_minute_per_ip' => 10,
        'checkpoints_per_hour_per_ip' => 30,
    ],
];
