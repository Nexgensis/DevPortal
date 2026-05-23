import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';

import { cn } from './utils';

function GlassDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="glass-dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

type GlassDialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  hideClose?: boolean;
};

export function GlassDialogContent({
  className,
  children,
  hideClose,
  ...props
}: GlassDialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <GlassDialogOverlay />
      <DialogPrimitive.Content
        data-slot="glass-dialog-content"
        className={cn(
          'glass-card-strong fixed top-[50%] left-[50%] z-50 grid w-full',
          'max-w-[calc(100%-2rem)] sm:max-w-[560px]',
          'translate-x-[-50%] translate-y-[-50%] gap-4 p-6',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'duration-200',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 right-4 rounded-full p-1 transition-colors',
              'text-slate-500 hover:text-slate-900 hover:bg-black/5',
              'focus-ring-cyan disabled:pointer-events-none',
              '[&_svg]:size-4',
            )}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const GlassDialog = DialogPrimitive.Root;
export const GlassDialogTrigger = DialogPrimitive.Trigger;
export const GlassDialogClose = DialogPrimitive.Close;

export function GlassDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="glass-dialog-header"
      className={cn('flex flex-col gap-2 text-left', className)}
      {...props}
    />
  );
}

export function GlassDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="glass-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function GlassDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="glass-dialog-title"
      className={cn('text-lg font-semibold leading-none text-slate-900', className)}
      {...props}
    />
  );
}

export function GlassDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="glass-dialog-description"
      className={cn('text-sm text-slate-600', className)}
      {...props}
    />
  );
}
