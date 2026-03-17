import type { DailyCost } from '@/lib/api'
import { formatCost } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface CostBreakdownProps {
  dailyCosts: DailyCost[]
  weeklyData: Record<string, unknown> | null
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm shadow-lg">
      <p className="mb-0.5 font-medium text-zinc-300">{label}</p>
      <p className="text-blue-400">{formatCost(payload[0].value)}</p>
    </div>
  )
}

export function CostBreakdown({ dailyCosts, weeklyData }: CostBreakdownProps) {
  const totalCost = dailyCosts.reduce((sum, d) => sum + d.cost, 0)
  const avgCost = dailyCosts.length > 0 ? totalCost / dailyCosts.length : 0

  const weeklyTotal =
    weeklyData && typeof weeklyData.totalCost === 'number' ? weeklyData.totalCost : null

  const formatted = dailyCosts.map((d) => ({
    ...d,
    label: d.date.slice(5), // MM-DD
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-400">
          Custo (últimos 30 dias)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary row */}
        <div className="mb-4 flex gap-6 text-sm">
          <div>
            <p className="text-zinc-500">Total 30d</p>
            <p className="font-semibold text-zinc-200">{formatCost(totalCost)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Média/dia</p>
            <p className="font-semibold text-zinc-200">{formatCost(avgCost)}</p>
          </div>
          {weeklyTotal !== null && (
            <div>
              <p className="text-zinc-500">Semana</p>
              <p className="font-semibold text-zinc-200">{formatCost(weeklyTotal)}</p>
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formatted} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={{ stroke: '#3f3f46' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="cost"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6' }}
                fill="url(#costGradient)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
