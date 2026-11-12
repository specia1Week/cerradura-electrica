'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type HourlyPoint = {
  hour: number;
  label: string;
  permitidos: number;
  denegados: number;
};

export function HourlyChart({ data }: { data: HourlyPoint[] }) {
  return (
    <div className="h-[300px] w-full md:h-[330px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, left: -22, bottom: 0 }}
          barCategoryGap={6}
        >
          <CartesianGrid
            strokeDasharray="3 6"
            vertical={false}
            stroke="oklch(var(--border))"
            opacity={0.7}
          />
          <XAxis
            dataKey="hour"
            tickFormatter={(value: number) =>
              value % 3 === 0 ? `${String(value).padStart(2, '0')}h` : ''
            }
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'oklch(var(--muted-foreground))', fontSize: 11 }}
            interval={0}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: 'oklch(var(--muted-foreground))', fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: 'oklch(var(--muted))', opacity: 0.35 }}
            contentStyle={{
              background: 'oklch(var(--popover))',
              border: '1px solid oklch(var(--border))',
              borderRadius: 12,
              color: 'oklch(var(--popover-foreground))',
              fontSize: 12,
              boxShadow: 'var(--shadow-float)',
            }}
            labelFormatter={(value) => `${String(value).padStart(2, '0')}:00`}
          />
          <Bar
            dataKey="permitidos"
            name="Permitidos"
            stackId="access"
            fill="oklch(var(--primary))"
            radius={[0, 0, 3, 3]}
            maxBarSize={22}
          />
          <Bar
            dataKey="denegados"
            name="Denegados"
            stackId="access"
            fill="oklch(var(--destructive))"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
