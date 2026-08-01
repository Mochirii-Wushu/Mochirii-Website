<footer>
    <div class="container py-5">
        <p class="text-center text-uppercase font-weight-bold small text-justify">
          @if(config('instance.restricted.enabled') == false)
          @auth
            <a href="{{route('site.about')}}" class="text-dark p-2">{{__('site.about')}}</a>
            <a href="{{route('site.help')}}" class="text-dark p-2">{{__('site.help')}}</a>
          @endauth
          <a href="{{route('site.terms')}}" class="text-dark p-2">{{__('site.terms')}}</a>
          <a href="{{route('site.privacy')}}" class="text-dark p-2">{{__('site.privacy')}}</a>
          @auth
            <a href="{{route('site.language')}}" class="text-dark p-2">{{__('site.language')}}</a>
          @endauth
          @if(config_cache('instance.has_legal_notice'))
            <a href="/site/legal-notice" class="text-dark p-2">{{__('web.navmenu.legalNotice')}}</a>
          @endif
          @guest
            <a href="https://mochirii.com/" class="text-dark p-2">Mōchirīī</a>
          @endguest
          @endif
          <a href="{{route('site.opensource')}}" class="text-dark p-2">Open-source notices</a>
        </p>
        <p class="text-center text-muted small mb-0">
          <span class="text-muted">&copy; {{date('Y')}} Mōchirīī Social</span>
        </p>
    </div>
</footer>
