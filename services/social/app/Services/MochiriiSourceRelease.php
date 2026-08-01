<?php

namespace App\Services;

final class MochiriiSourceRelease
{
    private const REPOSITORY_URL = 'https://github.com/Mochirii-Wushu/Mochirii-Website';
    private const SOCIAL_SUBDIRECTORY = 'services/social';

    private function __construct(private readonly string $revision) {}

    public static function current(): ?self
    {
        $repositoryUrl = config('mochirii-source.repository_url');
        $revision = config('mochirii-source.revision');
        $subdirectory = config('mochirii-source.subdirectory');

        if (
            $repositoryUrl !== self::REPOSITORY_URL ||
            $subdirectory !== self::SOCIAL_SUBDIRECTORY ||
            ! is_string($revision) ||
            preg_match('/\A[0-9a-f]{40}\z/D', $revision) !== 1
        ) {
            return null;
        }

        return new self($revision);
    }

    public function revision(): string
    {
        return $this->revision;
    }

    public function commitUrl(): string
    {
        return self::REPOSITORY_URL.'/commit/'.$this->revision;
    }

    public function browseUrl(): string
    {
        return self::REPOSITORY_URL.'/tree/'.$this->revision.'/'.self::SOCIAL_SUBDIRECTORY;
    }

    public function archiveUrl(): string
    {
        return self::REPOSITORY_URL.'/archive/'.$this->revision.'.zip';
    }

    public function licenseUrl(): string
    {
        return self::REPOSITORY_URL.'/blob/'.$this->revision.'/'.self::SOCIAL_SUBDIRECTORY.'/LICENSE';
    }
}
