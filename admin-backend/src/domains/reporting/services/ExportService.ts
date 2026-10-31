// import { Workbook } from 'exceljs'; // TODO: Install exceljs package: npm install exceljs
import { Readable } from 'stream';

export interface ExportColumn {
	header: string;
	key: string;
	width?: number;
	format?: (value: any) => string;
}

export interface ExportOptions {
	filename: string;
	sheetName?: string;
	columns: ExportColumn[];
	data: any[];
	title?: string;
	metadata?: Record<string, string>;
}

export class ExportService {
	/**
	 * Generate CSV file from data
	 */
	async generateCSV(options: ExportOptions): Promise<string> {
		const { columns, data } = options;

		// Build CSV header
		const header = columns.map(col => this.escapeCSVValue(col.header)).join(',');

		// Build CSV rows
		const rows = data.map(row => {
			return columns
				.map(col => {
					const value = row[col.key];
					const formattedValue = col.format ? col.format(value) : value;
					return this.escapeCSVValue(formattedValue);
				})
				.join(',');
		});

		// Combine header and rows
		return [header, ...rows].join('\n');
	}

	/**
	 * Generate Excel file from data
	 * NOTE: Requires exceljs package. Install with: npm install exceljs
	 */
	async generateExcel(options: ExportOptions): Promise<Buffer> {
		throw new Error(
			'Excel export is not available. Please install exceljs: npm install exceljs. For now, use CSV export.'
		);
		
		// TODO: Uncomment when exceljs is installed
		/*
		const { filename, sheetName = 'Sheet1', columns, data, title, metadata } = options;

		const workbook = new Workbook();
		const worksheet = workbook.addWorksheet(sheetName);

		let currentRow = 1;

		// Add title if provided
		if (title) {
			worksheet.mergeCells(`A${currentRow}:${this.getColumnLetter(columns.length)}${currentRow}`);
			const titleCell = worksheet.getCell(`A${currentRow}`);
			titleCell.value = title;
			titleCell.font = { size: 16, bold: true };
			titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
			currentRow += 2;
		}

		// Add metadata if provided
		if (metadata) {
			Object.entries(metadata).forEach(([key, value]) => {
				worksheet.getCell(`A${currentRow}`).value = `${key}:`;
				worksheet.getCell(`B${currentRow}`).value = value;
				worksheet.getCell(`A${currentRow}`).font = { bold: true };
				currentRow++;
			});
			currentRow++;
		}

		// Add header row
		const headerRow = worksheet.getRow(currentRow);
		columns.forEach((col, index) => {
			const cell = headerRow.getCell(index + 1);
			cell.value = col.header;
			cell.font = { bold: true };
			cell.fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFE0E0E0' },
			};
			cell.border = {
				top: { style: 'thin' },
				left: { style: 'thin' },
				bottom: { style: 'thin' },
				right: { style: 'thin' },
			};
			if (col.width) {
				worksheet.getColumn(index + 1).width = col.width;
			}
		});
		currentRow++;

		// Add data rows
		data.forEach(row => {
			const dataRow = worksheet.getRow(currentRow);
			columns.forEach((col, index) => {
				const cell = dataRow.getCell(index + 1);
				const value = row[col.key];
				cell.value = col.format ? col.format(value) : value;
			});
			currentRow++;
		});

		// Auto-fit columns if width not specified
		worksheet.columns.forEach((column, index) => {
			if (!columns[index].width) {
				let maxLength = 0;
				column.eachCell({ includeEmpty: false }, (cell) => {
					const cellValue = cell.value ? cell.value.toString() : '';
					maxLength = Math.max(maxLength, cellValue.length);
				});
				column.width = Math.min(maxLength + 2, 50);
			}
		});

		// Generate buffer
		const buffer = await workbook.xlsx.writeBuffer();
		return Buffer.from(buffer);
		*/
	}

	/**
	 * Generate streaming CSV (for large datasets)
	 */
	async generateStreamingCSV(
		columns: ExportColumn[],
		dataStream: AsyncIterable<any>
	): Promise<Readable> {
		const readable = new Readable({
			read() {},
		});

		// Write header
		const header = columns.map(col => this.escapeCSVValue(col.header)).join(',');
		readable.push(header + '\n');

		// Stream data rows
		(async () => {
			try {
				for await (const row of dataStream) {
					const csvRow = columns
						.map(col => {
							const value = row[col.key];
							const formattedValue = col.format ? col.format(value) : value;
							return this.escapeCSVValue(formattedValue);
						})
						.join(',');
					readable.push(csvRow + '\n');
				}
				readable.push(null); // End stream
			} catch (error) {
				readable.destroy(error as Error);
			}
		})();

		return readable;
	}

	/**
	 * Export player list
	 */
	async exportPlayers(players: any[], format: 'csv' | 'xlsx'): Promise<string | Buffer> {
		const columns: ExportColumn[] = [
			{ header: 'Player ID', key: 'id', width: 15 },
			{ header: 'Username', key: 'username', width: 20 },
			{ header: 'Email', key: 'email', width: 25 },
			{ header: 'Phone', key: 'phone', width: 15 },
			{ header: 'Status', key: 'status', width: 12 },
			{ header: 'Balance', key: 'balance', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Currency', key: 'currency', width: 10 },
{ header: 'Created At', key: 'createdAt', width: 20, format: (v) => new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
		{ header: 'Last Login', key: 'lastLoginAt', width: 20, format: (v) => v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never' },
		];

		const options: ExportOptions = {
			filename: `players-${Date.now()}`,
			sheetName: 'Players',
			columns,
			data: players,
			title: 'Player List Export',
			metadata: {
				'Generated On': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
				'Total Players': players.length.toString(),
			},
		};

		return format === 'csv' ? this.generateCSV(options) : this.generateExcel(options);
	}

	/**
	 * Export transaction history
	 */
	async exportTransactions(transactions: any[], format: 'csv' | 'xlsx'): Promise<string | Buffer> {
		const columns: ExportColumn[] = [
			{ header: 'Transaction ID', key: 'id', width: 20 },
			{ header: 'Player', key: 'playerName', width: 20 },
			{ header: 'Type', key: 'type', width: 15 },
			{ header: 'Amount', key: 'amount', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Status', key: 'status', width: 12 },
			{ header: 'Date', key: 'createdAt', width: 20, format: (v) => new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) },
			{ header: 'Notes', key: 'notes', width: 30 },
		];

		const options: ExportOptions = {
			filename: `transactions-${Date.now()}`,
			sheetName: 'Transactions',
			columns,
			data: transactions,
			title: 'Transaction History Export',
			metadata: {
				'Generated On': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
				'Total Transactions': transactions.length.toString(),
			},
		};

		return format === 'csv' ? this.generateCSV(options) : this.generateExcel(options);
	}

	/**
	 * Export commission report
	 */
	async exportCommissionReport(data: any[], format: 'csv' | 'xlsx'): Promise<string | Buffer> {
		const columns: ExportColumn[] = [
			{ header: 'Period', key: 'period', width: 15 },
			{ header: 'Domain', key: 'domain', width: 12 },
			{ header: 'GGR', key: 'ggr', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Commission Rate', key: 'rate', width: 15, format: (v) => `${v}%` },
			{ header: 'Commission Earned', key: 'commission', width: 18, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Status', key: 'status', width: 12 },
		];

		const options: ExportOptions = {
			filename: `commission-report-${Date.now()}`,
			sheetName: 'Commission',
			columns,
			data,
			title: 'Commission Report',
			metadata: {
				'Generated On': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
			},
		};

		return format === 'csv' ? this.generateCSV(options) : this.generateExcel(options);
	}

	/**
	 * Export settlement report
	 */
	async exportSettlementReport(data: any[], format: 'csv' | 'xlsx'): Promise<string | Buffer> {
		const columns: ExportColumn[] = [
			{ header: 'Period', key: 'period', width: 15 },
			{ header: 'Domain', key: 'domain', width: 12 },
			{ header: 'Net P&L', key: 'netPL', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Share Rate', key: 'shareRate', width: 12, format: (v) => `${v}%` },
			{ header: 'Agent Share', key: 'agentShare', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Currency', key: 'currency', width: 10 },
			{ header: 'Status', key: 'status', width: 12 },
		];

		const options: ExportOptions = {
			filename: `settlement-report-${Date.now()}`,
			sheetName: 'Settlement',
			columns,
			data,
			title: 'Settlement Report',
			metadata: {
				'Generated On': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
			},
		};

		return format === 'csv' ? this.generateCSV(options) : this.generateExcel(options);
	}

	/**
	 * Export GGR breakdown
	 */
	async exportGGRBreakdown(data: any[], format: 'csv' | 'xlsx'): Promise<string | Buffer> {
		const columns: ExportColumn[] = [
			{ header: 'Date', key: 'date', width: 15 },
			{ header: 'Domain', key: 'domain', width: 12 },
			{ header: 'Total Bets', key: 'totalBets', width: 12 },
			{ header: 'Total Stake', key: 'totalStake', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Total Payout', key: 'totalPayout', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'GGR', key: 'ggr', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Currency', key: 'currency', width: 10 },
		];

		const options: ExportOptions = {
			filename: `ggr-breakdown-${Date.now()}`,
			sheetName: 'GGR Breakdown',
			columns,
			data,
			title: 'GGR Breakdown Report',
			metadata: {
				'Generated On': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
			},
		};

		return format === 'csv' ? this.generateCSV(options) : this.generateExcel(options);
	}

	/**
	 * Export sub-agent performance
	 */
	async exportSubAgentPerformance(data: any[], format: 'csv' | 'xlsx'): Promise<string | Buffer> {
		const columns: ExportColumn[] = [
			{ header: 'Agent ID', key: 'agentId', width: 15 },
			{ header: 'Username', key: 'username', width: 20 },
			{ header: 'Scheme Type', key: 'schemeType', width: 15 },
			{ header: 'Total Players', key: 'totalPlayers', width: 12 },
			{ header: 'Active Players', key: 'activePlayers', width: 12 },
			{ header: 'Total GGR', key: 'totalGGR', width: 15, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Commission/Share', key: 'earnings', width: 18, format: (v) => v?.toFixed(2) || '0.00' },
			{ header: 'Status', key: 'status', width: 12 },
			{ header: 'Currency', key: 'currency', width: 10 },
		];

		const options: ExportOptions = {
			filename: `subagent-performance-${Date.now()}`,
			sheetName: 'Sub-Agent Performance',
			columns,
			data,
			title: 'Sub-Agent Performance Report',
			metadata: {
				'Generated On': new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
				'Total Sub-Agents': data.length.toString(),
			},
		};

		return format === 'csv' ? this.generateCSV(options) : this.generateExcel(options);
	}

	/**
	 * Escape CSV value to handle commas, quotes, and newlines
	 */
	private escapeCSVValue(value: any): string {
		if (value === null || value === undefined) {
			return '';
		}

		const strValue = String(value);

		// If value contains comma, quote, or newline, wrap in quotes and escape existing quotes
		if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
			return `"${strValue.replace(/"/g, '""')}"`;
		}

		return strValue;
	}

	/**
	 * Get Excel column letter from index (0-based)
	 */
	private getColumnLetter(index: number): string {
		let letter = '';
		let num = index;

		while (num >= 0) {
			letter = String.fromCharCode(65 + (num % 26)) + letter;
			num = Math.floor(num / 26) - 1;
		}

		return letter;
	}
}

