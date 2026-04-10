import { useState, useRef, useEffect } from 'react';
import { ExternalLink, Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const ASSISTANT_LABELS: Record<string, { label: string; color: string }> = {
  claude: { label: 'Claude', color: 'text-orange-400' },
  codex: { label: 'Codex', color: 'text-green-400' },
  copilot: { label: 'Copilot', color: 'text-blue-400' },
};

interface HeaderProps {
  title: string;
  subtitle?: string;
  projectName?: string;
  connected?: boolean;
  isDocker?: boolean;
  assistantType?: string;
  onAssistantChange?: (type: string) => void;
}

function smartPath(fullPath: string): string {
  const segments = fullPath.split('/').filter(Boolean);
  if (segments.length <= 3) return fullPath;
  return '.../' + segments.slice(-3).join('/');
}

export function Header({
  title,
  subtitle,
  projectName,
  connected,
  isDocker,
  assistantType,
  onAssistantChange,
}: HeaderProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) document.addEventListener('mousedown', handleClickOutside);
    return (): void => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  const openInVSCode = (): void => {
    if (subtitle) {
      // Normalize backslashes to forward slashes for the vscode:// URI
      const normalizedPath = subtitle.replace(/\\/g, '/');
      window.open(`vscode://file/${normalizedPath}`, '_blank');
    }
  };

  const copyPath = (): void => {
    if (subtitle) {
      void navigator.clipboard.writeText(subtitle).then(() => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1500);
      });
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border px-6">
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h1 className="text-base font-semibold text-text-primary">{title}</h1>
        {subtitle ? (
          <button
            onClick={copyPath}
            className="group flex items-center gap-1 text-xs text-text-secondary truncate max-w-sm hover:text-text-primary transition-colors text-left"
            title={subtitle}
          >
            <span className="truncate">{smartPath(subtitle)}</span>
            {copied ? (
              <Check className="h-3 w-3 shrink-0 text-success" />
            ) : (
              <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
            )}
          </button>
        ) : projectName ? (
          <span className="text-xs text-text-secondary">{projectName}</span>
        ) : connected !== undefined ? (
          <span className="text-xs text-text-tertiary italic">No project</span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-3">
        {assistantType && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={(): void => {
                if (onAssistantChange) setShowDropdown(!showDropdown);
              }}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                ASSISTANT_LABELS[assistantType]?.color ?? 'text-text-secondary',
                onAssistantChange ? 'hover:bg-surface cursor-pointer' : 'cursor-default'
              )}
              title={onAssistantChange ? 'Switch assistant' : 'Current assistant'}
            >
              <span>{ASSISTANT_LABELS[assistantType]?.label ?? assistantType}</span>
              {onAssistantChange && <ChevronDown className="h-3 w-3" />}
            </button>
            {showDropdown && onAssistantChange && (
              <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-border bg-surface-elevated shadow-lg py-1 min-w-[120px]">
                {Object.entries(ASSISTANT_LABELS).map(([key, { label, color }]) => (
                  <button
                    key={key}
                    onClick={() => {
                      onAssistantChange(key);
                      setShowDropdown(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-surface',
                      key === assistantType ? 'font-semibold' : 'text-text-secondary'
                    )}
                  >
                    <span className={color}>{label}</span>
                    {key === assistantType && <Check className="h-3 w-3 ml-auto text-success" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {subtitle && !isDocker && (
          <button
            onClick={openInVSCode}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
            title="Open in VS Code"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open in IDE</span>
          </button>
        )}
        {connected !== undefined && (
          <div className="flex items-center gap-2">
            <div
              className={cn('h-2 w-2 rounded-full', connected ? 'bg-success' : 'bg-text-tertiary')}
            />
            <span className="text-xs text-text-tertiary">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
