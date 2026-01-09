import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from './ui/card';
import { Activity, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';

const API_BASE = 'http://localhost:10000/api';

interface AuthCallbackProps {
  onAuthSuccess: (token: string) => Promise<boolean>;
}

export function AuthCallback({ onAuthSuccess }: AuthCallbackProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing authentication...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get token from URL params
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (!token) {
          throw new Error('No authentication token received');
        }

        // Validate and store the token
        const success = await onAuthSuccess(token);
        
        if (success) {
          setStatus('success');
          setMessage('Successfully authenticated!');
          
          // Redirect to main app after a brief delay
          setTimeout(() => {
            window.location.href = '/';
          }, 1500);
        } else {
          throw new Error('Failed to validate authentication token');
        }
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Authentication failed');
        
        // Redirect to login after delay
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      }
    };

    handleCallback();
  }, [onAuthSuccess]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-white">
      <Card className="w-full max-w-md bento-card">
        <CardHeader className="space-y-6 pt-12">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-xl bg-accent border-3 border-black flex items-center justify-center">
              {status === 'loading' && <Loader2 className="h-10 w-10 text-black animate-spin" />}
              {status === 'success' && <CheckCircle2 className="h-10 w-10 text-black" />}
              {status === 'error' && <AlertCircle className="h-10 w-10 text-black" />}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-12">
          <div className="space-y-5">
            {status === 'loading' && (
              <div className="text-center">
                <p className="text-lg font-medium mb-2">Authenticating...</p>
                <p className="text-sm text-muted-foreground">{message}</p>
              </div>
            )}
            
            {status === 'success' && (
              <Alert className="rounded-lg border-2 border-[#10B981] bg-[#10B981]/10">
                <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
                <AlertDescription className="text-[#10B981]">{message}</AlertDescription>
              </Alert>
            )}
            
            {status === 'error' && (
              <Alert variant="destructive" className="rounded-lg border-2 border-[#EF4444] bg-[#EF4444]/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
