@extends('layouts.app', ['title' => 'Monthly Raffle | ' . config('mochirii-branding.guild_name')])

@push('meta')
	<meta name="robots" content="noindex, nofollow, noarchive">
@endpush

@section('content')
<div class="container py-4 py-md-5">
	<div class="row justify-content-center">
		<div class="col-12 col-lg-9 col-xl-8">
			<header class="mb-4">
				<p class="text-uppercase text-muted font-weight-bold small mb-2">{{ config('mochirii-branding.guild_name') }}</p>
				<h1 class="h2 font-weight-bold mb-2">Monthly Raffle Leaderboard</h1>
				<p class="lead text-muted mb-0">Each point is one raffle entry.</p>
			</header>

			<section class="card border-0 shadow-sm" aria-labelledby="raffle-cycle-heading">
				<div class="card-header bg-white border-bottom py-3">
					<h2 id="raffle-cycle-heading" class="h5 font-weight-bold mb-0">{{ $leaderboard['cycleLabel'] }}</h2>
				</div>

				@if(count($leaderboard['entries']) === 0)
					<div class="card-body py-5 text-center">
						<p class="h5 mb-2">No active raffle standings</p>
						<p class="text-muted mb-0">Current entries will appear here during an active monthly drawing.</p>
					</div>
				@else
					<div class="table-responsive">
						<table class="table table-borderless table-hover mb-0">
							<caption class="sr-only">Verified guild members participating in the current monthly raffle</caption>
							<thead class="thead-light">
								<tr>
									<th scope="col" class="pl-4">Rank</th>
									<th scope="col">Guild member</th>
									<th scope="col" class="text-right pr-4">Points</th>
								</tr>
							</thead>
							<tbody>
								@foreach($leaderboard['entries'] as $entry)
								<tr>
									<th scope="row" class="pl-4 align-middle">{{ $entry['rank'] }}</th>
									<td class="align-middle font-weight-bold text-break">{{ $entry['displayName'] }}</td>
									<td class="text-right pr-4 align-middle">{{ $entry['entryCount'] }}</td>
								</tr>
								@endforeach
							</tbody>
						</table>
					</div>
				@endif
			</section>

			<p class="mt-4 mb-0">
				<a class="font-weight-bold" href="https://mochirii.com/raffle" rel="noopener noreferrer">View raffle details and rules</a>
			</p>
		</div>
	</div>
</div>
@endsection
