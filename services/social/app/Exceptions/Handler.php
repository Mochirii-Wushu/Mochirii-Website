<?php

namespace App\Exceptions;

use App\Http\Middleware\MochiriiRequestId;
use GuzzleHttp\Exception\ConnectException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use League\OAuth2\Server\Exception\OAuthServerException;
use Throwable;

class Handler extends ExceptionHandler
{
    /**
     * A list of the exception types that are not reported.
     *
     * @var array
     */
    protected $dontReport = [
        OAuthServerException::class,
        ConnectException::class,
        ConnectionException::class,
    ];

    /**
     * A list of the inputs that are never flashed for validation exceptions.
     *
     * @var array
     */
    protected $dontFlash = [
        'code',
        'password',
        'password_confirmation',
    ];

    /**
     * Report or log an exception.
     *
     * @param  \Exception  $exception
     * @return void
     */
    public function report(Throwable $exception)
    {
        if ($this->shouldntReport($exception)) {
            return;
        }

        if (app()->environment('production') && ! config('app.debug')) {
            $isServerError = ! $this->isHttpException($exception)
                || $exception->getStatusCode() >= 500;

            if ($isServerError) {
                $context = [
                    'exception_type' => get_class($exception),
                    'http_status' => $this->isHttpException($exception)
                        ? $exception->getStatusCode()
                        : 500,
                ];

                if (app()->bound('request') && app('request') instanceof Request) {
                    $context = array_merge(
                        $context,
                        MochiriiRequestId::logContext(app('request')),
                    );
                }

                Log::error('Unhandled application exception.', $context);

                return;
            }
        }

        parent::report($exception);
    }

    /**
     * Register the exception handling callbacks for the application.
     *
     * @return void
     */
    public function register()
    {
        $this->reportable(function (\BadMethodCallException $e) {
            return app()->environment() !== 'production';
        });

        $this->reportable(function (ConnectionException $e) {
            return app()->environment() !== 'production';
        });
    }

    /**
     * Render an exception into an HTTP response.
     *
     * @param  Request  $request
     * @param  \Exception  $exception
     * @return Response
     */
    public function render($request, Throwable $exception)
    {
        if ($request->wantsJson()) {
            if ($exception instanceof HttpResponseException) {
                $response = $exception->getResponse();
                if (! app()->environment('production') || config('app.debug')) {
                    return $response;
                }

                return $this->safeJsonError($response->getStatusCode());
            }

            if ($exception instanceof ValidationException) {
                return response()->json([
                    'message' => $exception->getMessage(),
                    'errors' => $exception->validator->getMessageBag(),
                ], $exception->status);
            }

            if ($exception instanceof AuthenticationException) {
                return response()->json([
                    'error' => 'Unauthenticated.',
                ], 401);
            }

            if ($exception instanceof OAuthServerException) {
                return parent::render($request, $exception);
            }

            $isHttp = $this->isHttpException($exception);

            if (! app()->environment('production') || config('app.debug')) {
                return response()->json(
                    ['error' => $exception->getMessage()],
                    $isHttp ? $exception->getStatusCode() : 500,
                    $isHttp ? $exception->getHeaders() : [],
                );
            }

            return $this->safeJsonError(
                $isHttp ? $exception->getStatusCode() : 500,
            );
        }

        return parent::render($request, $exception);
    }

    private function safeJsonError(int $status)
    {
        $message = match ($status) {
            400 => 'Bad request.',
            401 => 'Unauthenticated.',
            403 => 'Forbidden.',
            404 => 'Not found.',
            405 => 'Method not allowed.',
            409 => 'Conflict.',
            422 => 'The request could not be validated.',
            429 => 'Too many requests.',
            default => $status >= 400 && $status < 500
                ? 'Request could not be completed.'
                : 'Server error.',
        };

        return response()->json(
            ['error' => $message],
            $status >= 400 && $status < 600 ? $status : 500,
        );
    }
}
