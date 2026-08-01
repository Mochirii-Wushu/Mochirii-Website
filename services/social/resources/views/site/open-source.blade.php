@extends('layouts.app', [
    'title' => 'Open-source notices · Mōchirīī Social',
])

@push('meta')
<meta name="description" content="Open-source notices and exact source information for Mōchirīī Social.">
<meta name="robots" content="noindex,follow">
@endpush

@section('content')
<div class="container mt-5 mb-5">
    <div class="col-12 col-lg-8 mx-auto">
        <p class="font-weight-bold text-lighter text-uppercase">Open-source notices</p>
        <div class="card border shadow-none">
            <div class="card-body p-4 p-md-5">
                <h1 class="h3 font-weight-bold">Source code</h1>
                <p>
                    Mōchirīī Social includes modified Pixelfed software. The upstream application
                    license is the GNU Affero General Public License, version 3. The complete license
                    text and additional third-party notices are preserved with the source.
                </p>

                @if($sourceRelease)
                    <p>
                        The exact Social source associated with this running release is identified by
                        commit <code>{{ $sourceRelease->revision() }}</code>.
                    </p>
                    <ul>
                        <li><a href="{{ $sourceRelease->browseUrl() }}" rel="external noreferrer">Browse the exact Social source</a></li>
                        <li><a href="{{ $sourceRelease->archiveUrl() }}" rel="external noreferrer">Download the exact repository archive</a></li>
                        <li><a href="{{ $sourceRelease->commitUrl() }}" rel="external noreferrer">Review the exact commit</a></li>
                        <li><a href="{{ $sourceRelease->licenseUrl() }}" rel="external noreferrer">Read the preserved license</a></li>
                    </ul>
                @else
                    <p role="status">Exact source release information is temporarily unavailable.</p>
                @endif

                <p class="mb-0">
                    This notice covers the Social application under <code>services/social</code>.
                    Other source in the Mōchirīī Website repository retains the license notices,
                    if any, provided with its own files.
                </p>
            </div>
        </div>
    </div>
</div>
@endsection
