<?php

return [
    /*
     * This value is replaced only while building the immutable Social image.
     * A source checkout or an incorrectly built image must not advertise a
     * release that it cannot identify exactly.
     */
    'revision' => '@MOCHIRII_SOURCE_REVISION@',
    'repository_url' => 'https://github.com/Mochirii-Wushu/Mochirii-Website',
    'subdirectory' => 'services/social',
];
