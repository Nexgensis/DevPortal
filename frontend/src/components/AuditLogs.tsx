import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { FileText, Search, RefreshCw, User, Play, Square, Plus, Edit, Trash2 } from 'lucide-react';
import { AuditLog } from '../types/app';
import { auditApi } from '../lib/api';
import { toast } from 'sonner';

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    action: '',
    resourceType: '',
    username: '',
  });
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setCurrentPage(1); // Reset to first page when filters or page size change
  }, [filters, pageSize]);

  useEffect(() => {
    loadLogs();
  }, [currentPage, filters, pageSize]);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const result = await auditApi.getLogs({
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
        action: filters.action || undefined,
        resourceType: filters.resourceType || undefined,
      });
      setLogs(result.logs || []);
      setTotal(result.total || 0);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
      toast.error('Failed to load audit logs');
      setLogs([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'start_app':
        return <Play className="h-4 w-4 text-green-600" />;
      case 'stop_app':
        return <Square className="h-4 w-4 text-red-600" />;
      case 'create_app':
      case 'create_server':
      case 'create_project':
      case 'create_user':
        return <Plus className="h-4 w-4 text-blue-600" />;
      case 'update_app':
      case 'update_server':
      case 'update_project':
      case 'update_user':
        return <Edit className="h-4 w-4 text-orange-600" />;
      case 'delete_app':
      case 'delete_server':
      case 'delete_project':
      case 'delete_user':
        return <Trash2 className="h-4 w-4 text-red-600" />;
      default:
        return <FileText className="h-4 w-4 text-gray-600" />;
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('start')) return 'bg-green-100 text-green-800 border-green-200';
    if (action.includes('stop')) return 'bg-red-100 text-red-800 border-red-200';
    if (action.includes('create')) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (action.includes('update')) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (action.includes('delete')) return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const formatDuration = (details: string) => {
    const durationMatch = details.match(/Duration: ([^,]+)/);
    if (durationMatch) {
      return durationMatch[1];
    }
    return null;
  };

  const filteredLogs = logs.filter(log =>
    log.username.toLowerCase().includes(filters.username.toLowerCase())
  );

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="bento-card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Audit Logs
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track all system activities and changes
          </p>
        </div>
        <Button
          variant="outline"
          onClick={loadLogs}
          disabled={isLoading}
          className="border-2 border-black rounded-lg h-11"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search by username..."
            value={filters.username}
            onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            className="border-2 border-black/10 rounded-lg h-11"
          />
        </div>
        <Select value={filters.action || '__all__'} onValueChange={(value) => setFilters({ ...filters, action: value === '__all__' ? '' : value })}>
          <SelectTrigger className="w-full sm:w-48 border-2 border-black/10 rounded-lg h-11">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent className="border-2 border-black/10">
            <SelectItem value="__all__">All Actions</SelectItem>
            <SelectItem value="start_app">Start App</SelectItem>
            <SelectItem value="stop_app">Stop App</SelectItem>
            <SelectItem value="create_app">Create App</SelectItem>
            <SelectItem value="update_app">Update App</SelectItem>
            <SelectItem value="delete_app">Delete App</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.resourceType || '__all__'} onValueChange={(value) => setFilters({ ...filters, resourceType: value === '__all__' ? '' : value })}>
          <SelectTrigger className="w-full sm:w-48 border-2 border-black/10 rounded-lg h-11">
            <SelectValue placeholder="Filter by resource" />
          </SelectTrigger>
          <SelectContent className="border-2 border-black/10">
            <SelectItem value="__all__">All Resources</SelectItem>
            <SelectItem value="app">Applications</SelectItem>
            <SelectItem value="server">Servers</SelectItem>
            <SelectItem value="project">Projects</SelectItem>
            <SelectItem value="user">Users</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Logs */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-pulse text-muted-foreground">Loading audit logs...</div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between gap-4 p-4 bg-white rounded-lg hover:bg-secondary/30 transition-all border-2 border-black/5 hover:border-black/10"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-shrink-0">
                  {getActionIcon(log.action)}
                  <Badge className={`${getActionColor(log.action)} border`}>
                    {log.action.replace('_', ' ')}
                  </Badge>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{log.username}</span>
                    <span className="text-muted-foreground flex-shrink-0">•</span>
                    <span className="truncate">{log.resourceName}</span>
                    <Badge variant="outline" className="flex-shrink-0">{log.resourceType}</Badge>
                  </div>

                  <div className="text-sm text-muted-foreground truncate">
                    {log.details}
                    {formatDuration(log.details) && (
                      <span className="ml-2 text-orange-600">
                        Duration: {formatDuration(log.details)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right text-sm text-muted-foreground flex-shrink-0">
                <div>{new Date(log.createdAt).toLocaleDateString()}</div>
                <div>{new Date(log.createdAt).toLocaleTimeString()}</div>
              </div>
            </div>
          ))}

          {filteredLogs.length === 0 && !isLoading && (
            <div className="text-center py-16 px-4 bg-secondary/30 rounded-xl border-2 border-dashed border-black/10">
              <div className="h-24 w-24 rounded-xl bg-white border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
                <FileText className="h-12 w-12 text-muted-foreground/60" />
              </div>
              <h3 className="mb-2">No Audit Logs Available</h3>
              <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                No logs found matching your filters.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t-2 border-black/10">
          <div className="flex items-center gap-4">
            <div className="text-sm text-muted-foreground">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of {total} logs
            </div>
            <Select value={pageSize.toString()} onValueChange={(value) => setPageSize(Number(value))}>
              <SelectTrigger className="w-32 h-9 rounded-lg border-2 border-black/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-2 border-black/10">
                <SelectItem value="10">10 per page</SelectItem>
                <SelectItem value="20">20 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="rounded-lg border-2 border-black/10"
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="rounded-lg border-2 border-black/10"
              >
                Previous
              </Button>

              {/* Page Numbers */}
              <div className="flex items-center gap-1">
                {(() => {
                  const pages: any[] = [];
                  const maxVisible = 5;
                  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

                  if (endPage - startPage < maxVisible - 1) {
                    startPage = Math.max(1, endPage - maxVisible + 1);
                  }

                  if (startPage > 1) {
                    pages.push(
                      <Button
                        key={1}
                        variant={1 === currentPage ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(1)}
                        className={`rounded-lg w-10 border-2 ${1 === currentPage ? 'bg-black text-white border-black' : 'border-black/10'}`}
                      >
                        1
                      </Button>
                    );
                    if (startPage > 2) {
                      pages.push(
                        <span key="ellipsis-start" className="px-2 text-muted-foreground">
                          ...
                        </span>
                      );
                    }
                  }

                  for (let i = startPage; i <= endPage; i++) {
                    if (i === 1 && startPage === 1) {
                      pages.push(
                        <Button
                          key={i}
                          variant={i === currentPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(i)}
                          className={`rounded-lg w-10 border-2 ${i === currentPage ? 'bg-black text-white border-black' : 'border-black/10'}`}
                        >
                          {i}
                        </Button>
                      );
                    } else if (i > 1) {
                      pages.push(
                        <Button
                          key={i}
                          variant={i === currentPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(i)}
                          className={`rounded-lg w-10 border-2 ${i === currentPage ? 'bg-black text-white border-black' : 'border-black/10'}`}
                        >
                          {i}
                        </Button>
                      );
                    }
                  }

                  if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                      pages.push(
                        <span key="ellipsis-end" className="px-2 text-muted-foreground">
                          ...
                        </span>
                      );
                    }
                    pages.push(
                      <Button
                        key={totalPages}
                        variant={totalPages === currentPage ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCurrentPage(totalPages)}
                        className={`rounded-lg w-10 border-2 ${totalPages === currentPage ? 'bg-black text-white border-black' : 'border-black/10'}`}
                      >
                        {totalPages}
                      </Button>
                    );
                  }

                  return pages;
                })()}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="rounded-lg border-2 border-black/10"
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="rounded-lg border-2 border-black/10"
              >
                Last
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}