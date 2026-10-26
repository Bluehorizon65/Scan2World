import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../api/hooks';
import { Logo } from '../../components/Logo';
import { Button, Field, Input, Notice } from '../../components/ui';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});
type Form = z.infer<typeof schema>;

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const auth = useAuth(mode);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/projects';
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const isLogin = mode === 'login';

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="Scan2World Studio home"><Logo /></Link>
        <h1 className="font-heading mt-10 text-2xl">{isLogin ? 'Sign in to your studio' : 'Create your studio account'}</h1>
        <p className="mt-2 text-sm text-muted">
          {isLogin ? 'Your projects, scans and exports are waiting.' : 'Projects and scans are private to your account.'}
        </p>
        <form className="mt-8 grid gap-5" noValidate onSubmit={handleSubmit((v) => auth.mutate(v, { onSuccess: () => navigate(next) }))}>
          <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" invalid={!!formState.errors.email} {...register('email')} />
          </Field>
          <Field label="Password" htmlFor="password" error={formState.errors.password?.message} hint={isLogin ? undefined : 'At least 10 characters.'}>
            <Input id="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} invalid={!!formState.errors.password} {...register('password')} />
          </Field>
          {auth.error && <Notice tone="error">{auth.error.message}</Notice>}
          <Button type="submit" variant="primary" loading={auth.isPending}>{isLogin ? 'Sign in' : 'Create account'}</Button>
        </form>
        <p className="mt-6 text-sm text-muted">
          {isLogin ? 'New here? ' : 'Already have an account? '}
          <Link className="text-brass underline-offset-4 hover:underline" to={isLogin ? `/register?next=${encodeURIComponent(next)}` : `/login?next=${encodeURIComponent(next)}`}>
            {isLogin ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
      </div>
    </main>
  );
}
