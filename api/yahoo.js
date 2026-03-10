export default async function handler(req, res) {
    const { symbol, interval, range } = req.query;

    const yahooSymbol = symbol || 'NQ=F';
    const yahooInterval = interval || '5m';
    const yahooRange = range || '5d';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${yahooInterval}&range=${yahooRange}&includePrePost=true`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com',
            },
        });

        if (!response.ok) {
            // Try alternative v8 endpoint with crumb
            const altUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${yahooInterval}&range=${yahooRange}&includePrePost=true`;
            const altResponse = await fetch(altUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                },
            });

            if (!altResponse.ok) {
                return res.status(altResponse.status).json({
                    error: `Yahoo Finance returned ${altResponse.status}`,
                });
            }

            const altData = await altResponse.json();
            res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
            return res.status(200).json(altData);
        }

        const data = await response.json();
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
